import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { createEntryDiff, indexSnapshot } from "@vsnap/core";
import type { ReviewSession, RunEvent } from "@vsnap/protocol";
import { VsnapError } from "@vsnap/protocol";
import type {
  ReviewIndex,
  SessionStore,
  StoredReviewEntry,
} from "@vsnap/session";
import { listOverlay } from "@vsnap/session";
import { BufferedRunEventWriter } from "./event-writer.js";
import { SnapshotReporter } from "./reporter.js";

interface TargetVitestNode {
  version: string;
  parseCLI(args: string[]): {
    filter: string[];
    options: Record<string, unknown>;
  };
  resolveConfig(
    options: Record<string, unknown>,
  ): Promise<{ vitestConfig: Record<string, unknown> }>;
  createVitest(
    mode: "test",
    options: Record<string, unknown>,
  ): Promise<TargetVitest>;
}
interface TargetVitest {
  version: string;
  projects: Array<{ config: { browser?: { enabled?: boolean } } }>;
  start(filters?: string[]): Promise<unknown>;
  close(): Promise<void>;
  cancelCurrentRun(reason: string): Promise<void>;
}
export interface RunVitestCaptureOptions {
  session: ReviewSession;
  store: SessionStore;
  environmentPath?: string;
  signal?: AbortSignal;
  onEvent?: (event: RunEvent) => void;
}
const activeRuns = new Map<string, TargetVitest>();
let runnerBusy = false;

// Test-only: when VSNAP_E2E_RUN_DELAY_MS is set, pause here so e2e tests can
// observe live progress before a fast run completes. Resolves early on abort.
async function holdForTestDelay(signal?: AbortSignal): Promise<void> {
  const ms = Number(process.env.VSNAP_E2E_RUN_DELAY_MS ?? 0);
  if (!Number.isFinite(ms) || ms <= 0 || signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  visit: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < values.length) {
      const index = next++;
      const value = values[index];
      if (value !== undefined) results[index] = await visit(value);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, worker),
  );
  return results;
}

function snapshotKind(
  relativePath: string,
  baseline: string | null,
  candidate: string | null,
): "external" | "file" | "inline-unsupported" {
  if (relativePath.endsWith(".snap")) return "external";
  const source = `${baseline ?? ""}\n${candidate ?? ""}`;
  if (
    /\.(?:[cm]?[jt]sx?)$/i.test(relativePath) &&
    /\b(?:toMatchInlineSnapshot|toThrowErrorMatchingInlineSnapshot)\s*\(/.test(
      source,
    )
  )
    return "inline-unsupported";
  return "file";
}

async function importTargetVitest(
  repositoryRoot: string,
): Promise<TargetVitestNode> {
  const require = createRequire(join(repositoryRoot, "package.json"));
  let nodePath: string;
  let packagePath: string;
  try {
    nodePath = require.resolve("vitest/node");
    packagePath = require.resolve("vitest/package.json");
  } catch {
    throw new VsnapError(
      "VITEST_NOT_FOUND",
      `Could not resolve the target project's Vitest installation from ${repositoryRoot}`,
    );
  }
  const pkg = require(packagePath) as { version: string };
  if (!pkg.version.startsWith("4."))
    throw new VsnapError(
      "UNSUPPORTED_VITEST",
      `Vitest ${pkg.version} is unsupported; install Vitest 4.x`,
    );
  return {
    ...((await import(pathToFileURL(nodePath).href)) as TargetVitestNode),
    version: pkg.version,
  };
}

export async function rebuildReviewIndex(
  session: ReviewSession,
  store: SessionStore,
  emit?: (
    type: RunEvent["type"],
    payload: Record<string, unknown>,
  ) => Promise<void>,
): Promise<void> {
  const directory = store.sessionDirectory(session);
  const overlay = await listOverlay(session, directory);
  const decisions = await store.readDecisions(session);
  const index: ReviewIndex = {
    schemaVersion: 1,
    files: [],
    entries: [],
    hunks: [],
  };
  for (const record of overlay) {
    const relativePath = relative(
      session.repositoryRoot,
      record.path,
    ).replaceAll("\\", "/");
    const indexed = indexSnapshot(
      relativePath,
      record.baseline,
      record.candidate,
      snapshotKind(relativePath, record.baseline, record.candidate),
      {
        ...(record.testId ? { testId: record.testId } : {}),
        ...(record.testFile
          ? {
              testFile: relative(
                session.repositoryRoot,
                record.testFile,
              ).replaceAll("\\", "/"),
            }
          : {}),
      },
    );
    if (indexed.entries.length === 0) continue;
    index.files.push(indexed.file);
    const prepared = await mapConcurrent(indexed.entries, 16, async (entry) => {
      const [baselineBlob, candidateBlob] = await Promise.all([
        entry.baseline === undefined
          ? undefined
          : store.writeBlob(session, entry.baseline),
        entry.candidate === undefined
          ? undefined
          : store.writeBlob(session, entry.candidate),
      ]);
      const {
        baseline: _baseline,
        candidate: _candidate,
        baselineBlob: _baselineBlob,
        candidateBlob: _candidateBlob,
        ...entryMetadata
      } = entry;
      const storedEntry: StoredReviewEntry = entryMetadata;
      if (baselineBlob !== undefined) storedEntry.baselineBlob = baselineBlob;
      if (candidateBlob !== undefined)
        storedEntry.candidateBlob = candidateBlob;
      const diff = createEntryDiff(
        entry.id,
        entry.baseline ?? "",
        entry.candidate ?? "",
        decisions,
      );
      return { entry, storedEntry, diff };
    });
    for (const { entry, storedEntry, diff } of prepared) {
      index.entries.push(storedEntry);
      index.hunks.push(
        ...diff.hunks.map(
          ({
            lines: _lines,
            decision: _decision,
            changeHash,
            summary,
            ...hunk
          }) => ({
            ...hunk,
            ...(changeHash === undefined ? {} : { changeHash }),
            ...(summary === undefined ? {} : { summary }),
          }),
        ),
      );
      await emit?.("snapshot.discovered", {
        fileId: indexed.file.id,
        entryId: entry.id,
        relativePath,
        provisional: true,
      });
      await emit?.("snapshot.diff-ready", {
        entryId: entry.id,
        hunkCount: diff.hunks.length,
      });
    }
  }
  await store.writeIndex(session, index);
}

async function executeVitestCapture(
  options: RunVitestCaptureOptions,
): Promise<ReviewSession> {
  let session = options.session;
  const vitestNode = await importTargetVitest(session.repositoryRoot);
  session = {
    ...session,
    vitestVersion: vitestNode.version,
    state: "collecting",
  };
  await options.store.save(session);
  // Test seam: hold the run in an active ("collecting") state for a bit so
  // e2e tests can reliably observe live progress before a fast run finishes.
  // Never set outside tests, so real runs are unaffected. Aborts promptly.
  await holdForTestDelay(options.signal);
  const forbidden = session.vitestArgs.some((arg) =>
    /^(--watch|-w|--ui|--api|--browser|--snapshotEnvironment)(?:=|$)/.test(arg),
  );
  if (forbidden)
    throw new VsnapError(
      "UNSUPPORTED_VITEST_MODE",
      "Watch, UI/API, browser mode, and custom snapshot environments are not supported",
    );
  const parsed = vitestNode.parseCLI(["vitest", ...session.vitestArgs]);
  const resolved = await vitestNode.resolveConfig({
    ...parsed.options,
    root: session.repositoryRoot,
  });
  if (resolved.vitestConfig.snapshotEnvironment)
    throw new VsnapError(
      "CUSTOM_SNAPSHOT_ENVIRONMENT",
      "Custom snapshotEnvironment implementations cannot be safely composed in v1",
    );
  const environmentPath =
    options.environmentPath ??
    new URL("./environment.js", import.meta.url).pathname;
  let sequence =
    (await options.store.readEvents(session)).at(-1)?.sequence ?? 0;
  const eventWriter = new BufferedRunEventWriter(options.store, session);
  const emit = (
    type: RunEvent["type"],
    payload: Record<string, unknown>,
  ): Promise<void> => {
    const event: RunEvent = {
      schemaVersion: 1,
      sequence: ++sequence,
      sessionId: session.id,
      type,
      timestamp: new Date().toISOString(),
      payload,
    };
    eventWriter.append(event);
    options.onEvent?.(event);
    return Promise.resolve();
  };
  const reporter = new SnapshotReporter(emit, () =>
    rebuildReviewIndex(session, options.store, emit),
  );
  const previousRoot = process.env.VSNAP_REPOSITORY_ROOT;
  const previousDirectory = process.env.VSNAP_SESSION_DIRECTORY;
  process.env.VSNAP_REPOSITORY_ROOT = session.repositoryRoot;
  process.env.VSNAP_SESSION_DIRECTORY = options.store.sessionDirectory(session);
  let vitest: TargetVitest | undefined;
  try {
    if (options.signal?.aborted)
      throw new VsnapError("INTERRUPTED", "Vitest capture was interrupted");
    vitest = await vitestNode.createVitest("test", {
      ...parsed.options,
      root: session.repositoryRoot,
      watch: false,
      update: "all",
      reporters: [reporter],
      snapshotEnvironment: environmentPath,
    });
    if (vitest.projects.some((project) => project.config.browser?.enabled))
      throw new VsnapError(
        "UNSUPPORTED_BROWSER_MODE",
        "Vitest browser projects are unsupported; select Node-mode projects only",
      );
    activeRuns.set(session.id, vitest);
    options.signal?.addEventListener(
      "abort",
      () => void vitest?.cancelCurrentRun("cancelled"),
      { once: true },
    );
    if (options.signal?.aborted)
      await vitest.cancelCurrentRun("cancelled before test execution");
    session = { ...session, state: "running" };
    await options.store.save(session);
    const started = Date.now();
    await vitest.start(parsed.filter);
    await eventWriter.close();
    const index = await options.store.readIndex(session);
    const events = await options.store.readEvents(session);
    const finished = events.filter((event) => event.type === "test.finished");
    const count = (status: string) =>
      finished.filter((event) => event.payload.status === status).length;
    session = {
      ...session,
      state: options.signal?.aborted ? "interrupted" : "completed",
      completedAt: new Date().toISOString(),
      summary: {
        total: finished.length,
        passed: count("passed"),
        failed: count("failed"),
        skipped: count("skipped"),
        pending: count("pending"),
        snapshotChanges: index.entries.length,
        durationMs: Date.now() - started,
      },
    };
    await options.store.save(session);
    return session;
  } catch (error) {
    session = {
      ...session,
      state: options.signal?.aborted ? "interrupted" : "failed",
      completedAt: new Date().toISOString(),
    };
    await options.store.save(session);
    if (options.signal?.aborted)
      throw new VsnapError(
        "INTERRUPTED",
        "Vitest capture was interrupted",
        error,
      );
    throw error;
  } finally {
    activeRuns.delete(session.id);
    if (vitest) await vitest.close();
    if (previousRoot === undefined) delete process.env.VSNAP_REPOSITORY_ROOT;
    else process.env.VSNAP_REPOSITORY_ROOT = previousRoot;
    if (previousDirectory === undefined)
      delete process.env.VSNAP_SESSION_DIRECTORY;
    else process.env.VSNAP_SESSION_DIRECTORY = previousDirectory;
  }
}

export async function runVitestCapture(
  options: RunVitestCaptureOptions,
): Promise<ReviewSession> {
  if (runnerBusy)
    throw new VsnapError(
      "SESSION_BUSY",
      "Another Vitest capture is already running in this process",
    );
  runnerBusy = true;
  try {
    return await executeVitestCapture(options);
  } finally {
    runnerBusy = false;
  }
}

export async function cancelVitestCapture(sessionId: string): Promise<void> {
  await activeRuns.get(sessionId)?.cancelCurrentRun("cancelled by user");
}
