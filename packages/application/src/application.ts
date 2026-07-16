import { readFile, realpath, stat } from "node:fs/promises";
import {
  applyAcceptedHunks,
  assertContainedPath,
  createEntryDiff,
  deriveDecision,
  sha256,
  stableId,
  synthesizeSnapshotFile,
  unifiedFilePatch,
} from "@vsnap/core";
import type {
  ApplyInput,
  ApplyPlan,
  ApplyResult,
  CreatePreviewInput,
  DecisionResult,
  EntryContent,
  EntryContentInput,
  EntryDiff,
  FileOperation,
  GetDiffInput,
  GetTestReviewInput,
  GetTestSourceInput,
  ListNodesInput,
  ListSessionsInput,
  Page,
  RerunInput,
  ReviewNode,
  ReviewSession,
  RunEvent,
  RunProgress,
  SessionSummary,
  SetDecisionInput,
  SnapshotApplication,
  StartRunInput,
  TestReview,
  TestSource,
  VerifyInput,
} from "@vsnap/protocol";
import { VsnapError } from "@vsnap/protocol";
import {
  cancelVitestCapture,
  rebuildReviewIndex,
  runVitestCapture,
} from "@vsnap/runner";
import type {
  ReviewIndex,
  SessionStoreOptions,
  StoredReviewEntry,
} from "@vsnap/session";
import { readOverlay, SessionStore, writeOverlay } from "@vsnap/session";
import { applyFilesystemPlan } from "./apply.js";
import {
  accumulateProgress,
  createProgressAccumulator,
  progressSnapshot,
} from "./progress.js";
import { locateTestSource } from "./source.js";

export interface SnapshotApplicationOptions extends SessionStoreOptions {
  store?: SessionStore;
  clock?: () => Date;
  logger?: Pick<Console, "info" | "warn" | "error">;
  environmentPath?: string;
}

interface SynthesizedFile {
  relativePath: string;
  baseline: string | null;
  accepted: string | null;
  remaining: string | null;
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  visit: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  let failed = false;
  let failure: unknown;
  const worker = async (): Promise<void> => {
    while (!failed && next < values.length) {
      const index = next++;
      const value = values[index];
      if (value === undefined) continue;
      try {
        results[index] = await visit(value);
      } catch (error) {
        failed = true;
        failure = error;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, worker),
  );
  if (failed) throw failure;
  return results;
}

export function createSnapshotApplication(
  options: SnapshotApplicationOptions = {},
): SnapshotApplication {
  const store = options.store ?? new SessionStore(options);
  const clock = options.clock ?? (() => new Date());
  const controllers = new Map<string, AbortController>();
  const exactFamilyId = (contentHash: string) =>
    stableId("family", contentHash);
  const hunkChangeHash = (hunk: ReviewIndex["hunks"][number]) =>
    hunk.changeHash ?? hunk.contentHash;
  const exactFamilyIndex = (index: ReviewIndex) => {
    const hunksByEntry = new Map<string, typeof index.hunks>();
    for (const hunk of index.hunks) {
      const hunks = hunksByEntry.get(hunk.entryId);
      if (hunks) hunks.push(hunk);
      else hunksByEntry.set(hunk.entryId, [hunk]);
    }
    const hashByEntry = new Map<string, string>();
    for (const [entryId, hunks] of hunksByEntry) {
      hunks.sort(
        (left, right) =>
          left.oldStart - right.oldStart || left.newStart - right.newStart,
      );
      hashByEntry.set(
        entryId,
        sha256(JSON.stringify(hunks.map((hunk) => hunkChangeHash(hunk)))),
      );
    }
    return { hashByEntry, hunksByEntry };
  };

  async function entryValues(
    session: ReviewSession,
    entry: StoredReviewEntry,
    blobReads?: Map<string, Promise<string | undefined>>,
  ): Promise<{ baseline: string; candidate: string }> {
    const readBlob = (hash?: string) => {
      if (!hash) return Promise.resolve(undefined);
      const cached = blobReads?.get(hash);
      if (cached) return cached;
      const pending = store.readBlob(session, hash);
      blobReads?.set(hash, pending);
      return pending;
    };
    const [baseline, candidate] = await Promise.all([
      readBlob(entry.baselineBlob),
      readBlob(entry.candidateBlob),
    ]);
    return {
      baseline: baseline ?? "",
      candidate: candidate ?? "",
    };
  }
  async function entryDiff(
    session: ReviewSession,
    entry: StoredReviewEntry,
    knownDecisions?: Awaited<ReturnType<SessionStore["readDecisions"]>>,
    blobReads?: Map<string, Promise<string | undefined>>,
  ) {
    const [values, decisions] = await Promise.all([
      entryValues(session, entry, blobReads),
      knownDecisions ?? store.readDecisions(session),
    ]);
    return createEntryDiff(
      entry.id,
      values.baseline,
      values.candidate,
      decisions,
    );
  }
  function matchingEntries(
    index: ReviewIndex,
    selector: string,
  ): StoredReviewEntry[] {
    if (selector.startsWith("family_")) {
      const familyIndex = exactFamilyIndex(index);
      return index.entries.filter((entry) => {
        const fingerprint = familyIndex.hashByEntry.get(entry.id);
        return Boolean(fingerprint && exactFamilyId(fingerprint) === selector);
      });
    }
    if (selector.startsWith("entry_"))
      return index.entries.filter((entry) => entry.id === selector);
    if (selector.startsWith("file_"))
      return index.entries.filter((entry) => entry.fileId === selector);
    if (selector.startsWith("test_")) {
      const test = selector.slice(5);
      return index.entries.filter(
        (entry) =>
          stableId("test", entry.fileId, entry.testName ?? entry.key).slice(
            5,
          ) === test,
      );
    }
    if (selector.startsWith("hunk_"))
      return index.entries.filter((entry) =>
        index.hunks.some(
          (hunk) => hunk.id === selector && hunk.entryId === entry.id,
        ),
      );
    if (selector === "run" || selector === "all") return index.entries;
    throw new VsnapError("INVALID_SELECTOR", `Unknown selector: ${selector}`);
  }

  async function synthesizedFiles(
    session: ReviewSession,
    index: ReviewIndex,
    decisions: Awaited<ReturnType<SessionStore["readDecisions"]>>,
  ): Promise<SynthesizedFile[]> {
    const files = index.files.filter(
      (file) => file.kind !== "inline-unsupported",
    );
    const supportedFileIds = new Set(files.map((file) => file.id));
    const entriesByFile = new Map<string, StoredReviewEntry[]>();
    for (const entry of index.entries) {
      if (!supportedFileIds.has(entry.fileId)) continue;
      const entries = entriesByFile.get(entry.fileId);
      if (entries) entries.push(entry);
      else entriesByFile.set(entry.fileId, [entry]);
    }
    const blobReads = new Map<string, Promise<string | undefined>>();
    const diffEntries = await mapConcurrent(
      index.entries.filter((entry) => supportedFileIds.has(entry.fileId)),
      16,
      async (entry) =>
        [
          entry.id,
          await entryDiff(session, entry, decisions, blobReads),
        ] as const,
    );
    const diffs = new Map(diffEntries);
    return mapConcurrent(files, 16, async (file) => {
      const absolute = `${session.repositoryRoot}/${file.relativePath}`;
      const [baselineOverlay, candidateOverlay] = await Promise.all([
        readOverlay(store.sessionDirectory(session), "baseline", absolute),
        file.parseMode === "opaque"
          ? readOverlay(store.sessionDirectory(session), "candidate", absolute)
          : undefined,
      ]);
      const baseline = baselineOverlay ?? null;
      const candidate = candidateOverlay ?? null;
      const entries = entriesByFile.get(file.id) ?? [];
      const acceptedValues = new Map<string, string | null>();
      const remainingValues = new Map<string, string | null>();
      for (const entry of entries) {
        const diff = diffs.get(entry.id);
        if (!diff)
          throw new VsnapError(
            "MISSING_DIFF",
            `No prepared diff exists for ${entry.id}`,
          );
        const acceptedText = applyAcceptedHunks(diff);
        const remainingText = applyAcceptedHunks({
          ...diff,
          hunks: diff.hunks.map((hunk) => ({
            ...hunk,
            decision: hunk.decision === "rejected" ? "pending" : "accepted",
          })),
        });
        acceptedValues.set(
          entry.key,
          entry.baselineBlob === undefined && acceptedText === ""
            ? null
            : entry.candidateBlob === undefined &&
                diff.hunks.every((h) => h.decision === "accepted")
              ? null
              : acceptedText,
        );
        remainingValues.set(
          entry.key,
          entry.baselineBlob === undefined && remainingText === ""
            ? null
            : entry.candidateBlob === undefined &&
                diff.hunks.every((h) => h.decision !== "rejected")
              ? null
              : remainingText,
        );
      }
      const accepted =
        file.parseMode === "opaque"
          ? entries[0]
            ? applyAcceptedHunks(diffs.get(entries[0].id))
            : baseline
          : synthesizeSnapshotFile(baseline, acceptedValues);
      let remaining: string | null;
      if (file.parseMode === "opaque") {
        const first = entries[0];
        const diff = first ? diffs.get(first.id) : undefined;
        remaining = diff
          ? applyAcceptedHunks({
              ...diff,
              hunks: diff.hunks.map((hunk) => ({
                ...hunk,
                decision: hunk.decision === "rejected" ? "pending" : "accepted",
              })),
            })
          : candidate;
        if (
          file.candidateHash === null &&
          diff?.hunks.every((h) => h.decision !== "rejected")
        )
          remaining = null;
      } else remaining = synthesizeSnapshotFile(baseline, remainingValues);
      return {
        relativePath: file.relativePath,
        baseline,
        accepted,
        remaining,
      };
    });
  }

  async function prepareApply(
    session: ReviewSession,
    expectedRevision?: number,
  ): Promise<{
    plan: ApplyPlan;
    index: ReviewIndex;
    synthesized: SynthesizedFile[];
  }> {
    if (expectedRevision !== undefined && expectedRevision !== session.revision)
      throw new VsnapError("STALE_REVISION", "Session revision changed");
    const [index, decisions] = await Promise.all([
      store.readIndex(session),
      store.readDecisions(session),
    ]);
    const synthesized = await synthesizedFiles(session, index, decisions);
    const prepared = await mapConcurrent(synthesized, 16, async (file) => {
      if (file.accepted === file.baseline) return { patch: "" };
      const patch = unifiedFilePatch(
        file.relativePath,
        file.baseline ?? "",
        file.accepted ?? "",
      );
      let operation: FileOperation;
      if (file.baseline === null && file.accepted !== null) {
        operation = {
          type: "create",
          relativePath: file.relativePath,
          expectedHash: null,
          contentBlob: await store.writeBlob(session, file.accepted),
        };
      } else if (file.accepted === null && file.baseline !== null) {
        operation = {
          type: "delete",
          relativePath: file.relativePath,
          expectedHash: sha256(file.baseline),
        };
      } else if (file.accepted !== null && file.baseline !== null) {
        const [contentBlob, mode] = await Promise.all([
          store.writeBlob(session, file.accepted),
          stat(`${session.repositoryRoot}/${file.relativePath}`)
            .then((value) => value.mode)
            .catch(() => undefined),
        ]);
        operation = {
          type: "update",
          relativePath: file.relativePath,
          expectedHash: sha256(file.baseline),
          contentBlob,
          ...(mode === undefined ? {} : { mode }),
        };
      } else {
        throw new VsnapError(
          "INVALID_APPLY_PLAN",
          `Could not prepare ${file.relativePath}`,
        );
      }
      return { patch, operation };
    });
    const patch = prepared.map((value) => value.patch).join("");
    return {
      index,
      synthesized,
      plan: {
        id: stableId("plan", session.id, session.revision, patch),
        sessionId: session.id,
        expectedRevision: session.revision,
        createdAt: clock().toISOString(),
        operations: prepared.flatMap((value) =>
          value.operation ? [value.operation] : [],
        ),
        acceptedHunks: index.hunks
          .filter((h) => decisions[h.id] === "accepted")
          .map((h) => h.id),
        rejectedHunks: index.hunks
          .filter((h) => decisions[h.id] === "rejected")
          .map((h) => h.id),
        pendingHunks: index.hunks
          .filter((h) => !decisions[h.id] || decisions[h.id] === "pending")
          .map((h) => h.id),
        patch,
      },
    };
  }

  const application: SnapshotApplication = {
    async startRun(input: StartRunInput): Promise<ReviewSession> {
      await store.cleanup(input.repositoryRoot);
      const session = await store.create(
        input.repositoryRoot,
        input.vitestArgs ?? [],
      );
      const controller = new AbortController();
      const abort = () => controller.abort(input.signal?.reason);
      if (input.signal?.aborted) abort();
      else input.signal?.addEventListener("abort", abort, { once: true });
      controllers.set(session.id, controller);
      const capture = () =>
        runVitestCapture({
          session,
          store,
          signal: controller.signal,
          ...(options.environmentPath
            ? { environmentPath: options.environmentPath }
            : {}),
        });
      const run = (
        input.headless === false
          ? capture()
          : store.withSessionLock(session, capture)
      ).finally(() => {
        controllers.delete(session.id);
        input.signal?.removeEventListener("abort", abort);
      });
      if (input.headless === false) {
        void run.catch((error) => options.logger?.error(error));
        return session;
      }
      return run;
    },
    async cancelRun(sessionId) {
      controllers.get(sessionId)?.abort();
      await cancelVitestCapture(sessionId);
      const session = await store.load(sessionId);
      if (["collecting", "running"].includes(session.state))
        await store.save({ ...session, state: "cancelling" });
    },
    async rerun(input: RerunInput) {
      const parent = await store.load(input.sessionId);
      const child = await store.create(
        parent.repositoryRoot,
        input.vitestArgs ?? parent.vitestArgs,
        parent.id,
      );
      const controller = new AbortController();
      controllers.set(child.id, controller);
      const run = runVitestCapture({
        session: child,
        store,
        signal: controller.signal,
        ...(options.environmentPath
          ? { environmentPath: options.environmentPath }
          : {}),
      }).finally(() => controllers.delete(child.id));
      // Kick the run off in the background and return the freshly-created child
      // session immediately (mirrors startRun with headless:false) so the UI can
      // navigate to it and stream live progress over SSE. Awaiting the run here
      // would block the HTTP response for its whole duration and defeat that.
      void run.catch((error) => options.logger?.error(error));
      return child;
    },
    async listSessions(input?: ListSessionsInput) {
      const root = input?.repositoryRoot ?? process.cwd();
      return (await store.list(root)).map(
        ({ id, state, revision, createdAt, summary, parentSessionId }) =>
          ({
            id,
            state,
            revision,
            createdAt,
            summary,
            ...(parentSessionId ? { parentSessionId } : {}),
          }) satisfies SessionSummary,
      );
    },
    getSession: (id) => store.load(id),
    async listNodes(input: ListNodesInput): Promise<Page<ReviewNode>> {
      const session = await store.load(input.sessionId);
      const index = await store.readIndex(session);
      const decisions = await store.readDecisions(session);
      const nodes: ReviewNode[] = [];
      const filePaths = new Map(
        index.files.map((file) => [file.id, file.relativePath]),
      );
      const fileById = new Map(index.files.map((file) => [file.id, file]));
      const hunksFor = (entryIds: string[]) =>
        index.hunks
          .filter((hunk) => entryIds.includes(hunk.entryId))
          .map((hunk) => ({
            ...hunk,
            decision: decisions[hunk.id] ?? ("pending" as const),
          }));
      const finishedTests = ["family", "test"].includes(input.kind ?? "")
        ? (await store.readEvents(session)).filter(
            (event) => event.type === "test.finished",
          )
        : [];
      const testGroupName = (entry: StoredReviewEntry): string => {
        const file = fileById.get(entry.fileId);
        const matches = finishedTests
          .filter((event) => {
            const eventId = String(event.payload.id ?? "");
            const eventName = String(event.payload.name ?? "");
            const eventFile = String(event.payload.file ?? "");
            return (
              (file?.testId
                ? eventId === file.testId
                : Boolean(file?.testFile && file.testFile === eventFile)) &&
              Boolean(
                eventName &&
                  entry.testName &&
                  (entry.testName === eventName ||
                    entry.testName.startsWith(`${eventName} > `)),
              )
            );
          })
          .sort(
            (left, right) =>
              String(right.payload.name ?? "").length -
              String(left.payload.name ?? "").length,
          );
        const matched = matches[0];
        if (matched) return String(matched.payload.name ?? entry.key);
        return entry.testName?.replace(/ > [^>]+$/, "") ?? entry.key;
      };
      const snapshotRole = (entry: StoredReviewEntry): string => {
        const file = fileById.get(entry.fileId);
        if (file?.kind === "file") return file.relativePath;
        if (file?.kind === "inline-unsupported") return "inline snapshot";
        const testName = testGroupName(entry);
        const namedSnapshot = entry.testName?.startsWith(`${testName} > `)
          ? entry.testName.slice(testName.length + 3)
          : undefined;
        return namedSnapshot || "snapshot";
      };
      const familyScope = (
        entries: StoredReviewEntry[],
      ): string | undefined => {
        const names = [
          ...new Set(entries.map((entry) => testGroupName(entry))),
        ];
        const segments = names.map((name) => name.split(" > "));
        const common: string[] = [];
        for (let index = 0; ; index += 1) {
          const segment = segments[0]?.[index];
          if (!segment || segments.some((items) => items[index] !== segment))
            break;
          common.push(segment);
        }
        if (common.length === 0) return undefined;
        return names.length === 1
          ? common.slice(-2).join(" › ")
          : common.at(-1);
      };
      if (input.kind === "family") {
        const familyIndex = exactFamilyIndex(index);
        const groups = new Map<string, StoredReviewEntry[]>();
        for (const entry of index.entries) {
          const fingerprint = familyIndex.hashByEntry.get(entry.id);
          if (!fingerprint) continue;
          const group = groups.get(fingerprint);
          if (group) group.push(entry);
          else groups.set(fingerprint, [entry]);
        }
        for (const [contentHash, entries] of groups) {
          const entryIds = entries.map((entry) => entry.id);
          const hunks = hunksFor(entryIds);
          const testIds = new Set(
            entries.map((entry) => {
              const file = fileById.get(entry.fileId);
              return stableId(
                "test",
                "family",
                file?.testFile ?? entry.fileId,
                testGroupName(entry),
              );
            }),
          );
          const firstEntry = entries[0];
          const representativeHunks = firstEntry
            ? (familyIndex.hunksByEntry.get(firstEntry.id) ?? [])
            : [];
          const firstHunk = representativeHunks[0];
          if (!firstEntry || !firstHunk) continue;
          const roles = [...new Set(entries.map(snapshotRole))];
          const roleLabel = roles.slice(0, 2).join(" + ");
          const omittedRoles = roles.length - 2;
          const locationLabel = `${roleLabel}${omittedRoles > 0 ? ` + ${omittedRoles} more` : ""}`;
          const scope = familyScope(entries);
          const changeLabel =
            representativeHunks.length === 1
              ? (firstHunk.summary ?? "Exact snapshot change")
              : `${representativeHunks.length} related changes · ${firstHunk.summary ?? "exact snapshot diff"}`;
          const changeTypes = new Set(entries.map((entry) => entry.changeType));
          nodes.push({
            id: exactFamilyId(contentHash),
            kind: "family",
            entryId: firstEntry.id,
            label: `${locationLabel}${scope ? ` in ${scope}` : ""} · ${changeLabel}`,
            decision: deriveDecision(hunks),
            ...(changeTypes.size === 1
              ? { changeType: firstEntry.changeType }
              : {}),
            childCount: entries.length,
            familyHash: contentHash,
            testCount: testIds.size,
            fileCount: new Set(entries.map((entry) => entry.fileId)).size,
            confidence: "exact",
          });
        }
        nodes.sort(
          (left, right) =>
            right.childCount - left.childCount ||
            left.label.localeCompare(right.label),
        );
      }
      if (!input.kind || input.kind === "file")
        for (const file of index.files) {
          const entries = index.entries.filter((e) => e.fileId === file.id);
          nodes.push({
            id: file.id,
            kind: "file",
            label: file.relativePath,
            decision: deriveDecision(hunksFor(entries.map((e) => e.id))),
            changeType: file.changeType,
            childCount: entries.length,
          });
        }
      if (!input.kind || input.kind === "test") {
        const groups = new Map<string, StoredReviewEntry[]>();
        for (const entry of index.entries) {
          const id = stableId("test", entry.fileId, testGroupName(entry));
          groups.set(id, [...(groups.get(id) ?? []), entry]);
        }
        for (const [id, entries] of groups) {
          const first = entries[0];
          if (!first) continue;
          nodes.push({
            id,
            kind: "test",
            entryId: first.id,
            parentId: first.fileId,
            label: testGroupName(first),
            decision: deriveDecision(hunksFor(entries.map((e) => e.id))),
            childCount: entries.length,
          });
        }
      }
      if (!input.kind || input.kind === "entry")
        for (const entry of index.entries)
          nodes.push({
            id: entry.id,
            kind: "entry",
            parentId: entry.fileId,
            label:
              entry.key === "<file>"
                ? (filePaths.get(entry.fileId) ?? entry.key)
                : entry.key,
            decision: deriveDecision(hunksFor([entry.id])),
            changeType: entry.changeType,
            childCount: index.hunks.filter((h) => h.entryId === entry.id)
              .length,
          });
      if (input.kind === "hunk")
        for (const hunk of index.hunks)
          nodes.push({
            id: hunk.id,
            kind: "hunk",
            parentId: hunk.entryId,
            label: `-${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines}`,
            decision: decisions[hunk.id] ?? "pending",
            childCount: 0,
          });
      const filtered = input.status
        ? nodes.filter(
            (node) =>
              node.decision === input.status ||
              node.changeType === input.status,
          )
        : nodes;
      const offset = Number(input.cursor ?? 0);
      const limit = Math.min(input.limit ?? 200, 10_000);
      return {
        items: filtered.slice(offset, offset + limit),
        total: filtered.length,
        ...(offset + limit < filtered.length
          ? { nextCursor: String(offset + limit) }
          : {}),
      };
    },
    async getEntryContent(input: EntryContentInput): Promise<EntryContent> {
      const session = await store.load(input.sessionId);
      const entry = (await store.readIndex(session)).entries.find(
        (value) => value.id === input.entryId,
      );
      if (!entry) throw new VsnapError("ENTRY_NOT_FOUND", input.entryId);
      const hash =
        input.side === "baseline" ? entry.baselineBlob : entry.candidateBlob;
      return {
        entryId: entry.id,
        side: input.side,
        content: (await store.readBlob(session, hash)) ?? null,
        hash: hash ?? null,
      };
    },
    async getDiff(input: GetDiffInput): Promise<EntryDiff> {
      const session = await store.load(input.sessionId);
      const index = await store.readIndex(session);
      const entry = index.entries.find((value) => value.id === input.entryId);
      if (!entry) throw new VsnapError("ENTRY_NOT_FOUND", input.entryId);
      const file = index.files.find((value) => value.id === entry.fileId);
      if (!file) throw new VsnapError("FILE_NOT_FOUND", entry.fileId);
      const events = await store.readEvents(session);
      const finishedTests = events
        .filter((event) => event.type === "test.finished")
        .filter((event) => {
          const eventId = String(event.payload.id ?? "");
          const eventName = String(event.payload.name ?? "");
          const eventFile = String(event.payload.file ?? "");
          if (file.testId) return eventId === file.testId;
          if (!entry.testName) return false;
          const nameMatches =
            entry.testName === eventName ||
            entry.testName.startsWith(`${eventName} > `);
          return nameMatches && (!file.testFile || file.testFile === eventFile);
        })
        .sort(
          (left, right) =>
            String(right.payload.name ?? "").length -
            String(left.payload.name ?? "").length,
        );
      const testEvent = finishedTests[0];
      const testName = testEvent
        ? String(testEvent.payload.name ?? "")
        : undefined;
      const snapshotName =
        file.kind === "external" && testName && entry.testName
          ? entry.testName.slice(testName.length).replace(/^ > /, "") ||
            undefined
          : file.kind === "file"
            ? file.relativePath
            : undefined;
      const location = testEvent?.payload.location;
      const testLocation =
        location &&
        typeof location === "object" &&
        "line" in location &&
        "column" in location &&
        typeof location.line === "number" &&
        typeof location.column === "number"
          ? { line: location.line, column: location.column }
          : undefined;
      const testSuites = Array.isArray(testEvent?.payload.suites)
        ? testEvent.payload.suites.flatMap((value) => {
            if (!value || typeof value !== "object") return [];
            const id = "id" in value ? value.id : undefined;
            const name = "name" in value ? value.name : undefined;
            if (typeof id !== "string" || typeof name !== "string") return [];
            const suiteLocation =
              "location" in value &&
              value.location &&
              typeof value.location === "object" &&
              "line" in value.location &&
              "column" in value.location &&
              typeof value.location.line === "number" &&
              typeof value.location.column === "number"
                ? {
                    line: value.location.line,
                    column: value.location.column,
                  }
                : undefined;
            return [
              {
                id,
                name,
                ...(suiteLocation ? { location: suiteLocation } : {}),
              },
            ];
          })
        : undefined;
      const diff = await entryDiff(session, entry);
      const hasTestContext = Boolean(
        file.testId || file.testFile || testName || entry.testName,
      );
      const contextTestId =
        file.testId ??
        (testEvent?.payload.id ? String(testEvent.payload.id) : undefined);
      const contextTestName = testName ?? entry.testName;
      const contextTestFile =
        file.testFile ??
        (testEvent?.payload.file ? String(testEvent.payload.file) : undefined);
      return {
        ...diff,
        context: {
          snapshotFile: file.relativePath,
          snapshotKind: file.kind,
          snapshotKey: entry.key,
          matcher:
            file.kind === "file"
              ? "toMatchFileSnapshot"
              : file.kind === "inline-unsupported"
                ? "toMatchInlineSnapshot"
                : "toMatchSnapshot",
          ...(snapshotName ? { snapshotName } : {}),
          changeType: entry.changeType,
          ...(entry.ordinal === undefined ? {} : { ordinal: entry.ordinal }),
          ...(hasTestContext
            ? {
                test: {
                  ...(contextTestId ? { id: contextTestId } : {}),
                  ...(contextTestName ? { name: contextTestName } : {}),
                  ...(contextTestFile ? { file: contextTestFile } : {}),
                  ...(testEvent?.payload.status
                    ? { status: String(testEvent.payload.status) }
                    : {}),
                  ...(typeof testEvent?.payload.durationMs === "number"
                    ? { durationMs: testEvent.payload.durationMs }
                    : {}),
                  ...(testLocation ? { location: testLocation } : {}),
                  ...(testSuites?.length ? { suites: testSuites } : {}),
                  ...(Array.isArray(testEvent?.payload.failures)
                    ? { failureCount: testEvent.payload.failures.length }
                    : {}),
                },
              }
            : {}),
        },
      };
    },
    async getTestSource(input: GetTestSourceInput): Promise<TestSource> {
      const session = await store.load(input.sessionId);
      const diff = await application.getDiff(input);
      const relativePath = diff.context.test?.file;
      if (!relativePath)
        throw new VsnapError(
          "TEST_SOURCE_NOT_FOUND",
          "The owning test source file was not reported for this snapshot",
        );
      const requestedPath = assertContainedPath(
        session.repositoryRoot,
        relativePath,
      );
      const canonicalPath = await realpath(requestedPath).catch(() => {
        throw new VsnapError(
          "TEST_SOURCE_NOT_FOUND",
          `Test source no longer exists: ${relativePath}`,
        );
      });
      assertContainedPath(session.repositoryRoot, canonicalPath);
      const sourceStats = await stat(canonicalPath);
      if (!sourceStats.isFile())
        throw new VsnapError(
          "TEST_SOURCE_NOT_FOUND",
          `Test source is not a regular file: ${relativePath}`,
        );
      if (sourceStats.size > 2_000_000)
        throw new VsnapError(
          "TEST_SOURCE_TOO_LARGE",
          "Test source is larger than the 2 MB read-only preview limit",
        );
      const content = await readFile(canonicalPath, "utf8");
      const located = locateTestSource(content, relativePath, diff.context);
      const snippet = content
        .split("\n")
        .slice(located.focus.startLine - 1, located.focus.endLine)
        .join("\n");
      const reviewedContent = located.blocks
        .map((block) => `${block.kind}:${block.startLine}\n${block.content}`)
        .join("\n");
      return {
        entryId: input.entryId,
        relativePath,
        content: snippet,
        contentHash: sha256(reviewedContent || snippet),
        ...located,
      };
    },
    async getTestReview(input: GetTestReviewInput): Promise<TestReview> {
      const session = await store.load(input.sessionId);
      const selected = await application.getDiff(input);
      const index = await store.readIndex(session);
      const testId = selected.context.test?.id;
      const testName = selected.context.test?.name;
      const testFile = selected.context.test?.file;
      const siblings = index.entries.filter((entry) => {
        if (entry.id === input.entryId) return true;
        const file = index.files.find((item) => item.id === entry.fileId);
        if (!file) return false;
        if (testId && file.testId === testId) return true;
        const sameTestName = Boolean(
          testName &&
            entry.testName &&
            (entry.testName === testName ||
              entry.testName.startsWith(`${testName} > `)),
        );
        return Boolean(sameTestName && testFile && file.testFile === testFile);
      });
      const entries = await Promise.all(
        siblings.map((entry) =>
          application.getDiff({
            sessionId: input.sessionId,
            entryId: entry.id,
          }),
        ),
      );
      entries.sort(
        (left, right) =>
          (left.context.ordinal ?? 0) - (right.context.ordinal ?? 0) ||
          left.context.snapshotKey.localeCompare(right.context.snapshotKey),
      );
      const sources = await Promise.all(
        entries.map((entry) =>
          application.getTestSource({
            sessionId: input.sessionId,
            entryId: entry.entryId,
          }),
        ),
      );
      const matcherLineByEntry = new Map(
        sources.map((source) => [
          source.entryId,
          source.focus.matcherLine ?? Number.MAX_SAFE_INTEGER,
        ]),
      );
      entries.sort(
        (left, right) =>
          (matcherLineByEntry.get(left.entryId) ?? Number.MAX_SAFE_INTEGER) -
          (matcherLineByEntry.get(right.entryId) ?? Number.MAX_SAFE_INTEGER),
      );
      const selectedSource =
        sources.find((source) => source.entryId === input.entryId) ??
        sources[0];
      if (!selectedSource)
        throw new VsnapError(
          "TEST_SOURCE_NOT_FOUND",
          "No source was found for the owning test",
        );
      const matcherLines = [
        ...new Set(
          sources.flatMap((source) => source.focus.matcherLines ?? []),
        ),
      ].sort((left, right) => left - right);
      const familyIndex = exactFamilyIndex(index);
      const selectedFamilyHash = familyIndex.hashByEntry.get(input.entryId);
      const familyEntries = selectedFamilyHash
        ? index.entries.filter(
            (entry) =>
              familyIndex.hashByEntry.get(entry.id) === selectedFamilyHash,
          )
        : index.entries.filter((entry) => entry.id === input.entryId);
      const filesById = new Map(index.files.map((file) => [file.id, file]));
      const finishedTests = (await store.readEvents(session)).filter(
        (event) => event.type === "test.finished",
      );
      const finishedTestsById = new Map<string, RunEvent[]>();
      const finishedTestsByFile = new Map<string, RunEvent[]>();
      for (const event of finishedTests) {
        const eventId = String(event.payload.id ?? "");
        const eventFile = String(event.payload.file ?? "");
        if (eventId) {
          const matches = finishedTestsById.get(eventId) ?? [];
          matches.push(event);
          finishedTestsById.set(eventId, matches);
        }
        if (eventFile) {
          const matches = finishedTestsByFile.get(eventFile) ?? [];
          matches.push(event);
          finishedTestsByFile.set(eventFile, matches);
        }
      }
      const occurrencesByTest = new Map<
        string,
        TestReview["occurrences"][number]
      >();
      for (const entry of familyEntries) {
        const file = filesById.get(entry.fileId);
        if (!file) continue;
        const possibleTestEvents = file.testId
          ? (finishedTestsById.get(file.testId) ?? [])
          : file.testFile
            ? (finishedTestsByFile.get(file.testFile) ?? [])
            : finishedTests;
        const testEvent = possibleTestEvents
          .filter((event) => {
            const eventId = String(event.payload.id ?? "");
            const eventName = String(event.payload.name ?? "");
            if (file.testId) return eventId === file.testId;
            const nameMatches = Boolean(
              entry.testName &&
                eventName &&
                (entry.testName === eventName ||
                  entry.testName.startsWith(`${eventName} > `)),
            );
            return nameMatches;
          })
          .sort(
            (left, right) =>
              String(right.payload.name ?? "").length -
              String(left.payload.name ?? "").length,
          )[0];
        const testName = testEvent?.payload.name
          ? String(testEvent.payload.name)
          : entry.testName?.replace(/ > [^>]+$/, "");
        const testFile =
          file.testFile ??
          (testEvent?.payload.file
            ? String(testEvent.payload.file)
            : undefined);
        const testId =
          file.testId ??
          (testEvent?.payload.id ? String(testEvent.payload.id) : undefined);
        if (!testId && !testName && !testFile) continue;
        const test = {
          ...(testId ? { id: testId } : {}),
          ...(testName ? { name: testName } : {}),
          ...(testFile ? { file: testFile } : {}),
        };
        const identity =
          test.id ??
          stableId(
            "test",
            "review-occurrence",
            test.file ?? file.relativePath,
            test.name ?? entry.testName ?? entry.key,
          );
        const occurrence = occurrencesByTest.get(identity);
        if (occurrence) {
          occurrence.snapshotCount += 1;
          if (entry.id === input.entryId) occurrence.entryId = entry.id;
        } else {
          occurrencesByTest.set(identity, {
            entryId: entry.id,
            test,
            snapshotCount: 1,
          });
        }
      }
      const occurrences = [...occurrencesByTest.values()].sort(
        (left, right) =>
          Number(right.entryId === input.entryId) -
            Number(left.entryId === input.entryId) ||
          (left.test.file ?? "").localeCompare(right.test.file ?? "") ||
          (left.test.name ?? "").localeCompare(right.test.name ?? ""),
      );
      return {
        sessionId: input.sessionId,
        ...(selected.context.test ? { test: selected.context.test } : {}),
        source: {
          ...selectedSource,
          focus: { ...selectedSource.focus, matcherLines },
        },
        entries,
        occurrences,
      };
    },
    async setDecision(input: SetDecisionInput): Promise<DecisionResult> {
      const unlockedSession = await store.load(input.sessionId);
      return store.withSessionLock(unlockedSession, async () => {
        const session = await store.load(input.sessionId);
        if (
          input.expectedRevision !== undefined &&
          input.expectedRevision !== session.revision
        )
          throw new VsnapError("STALE_REVISION", "Session revision changed", {
            expected: input.expectedRevision,
            actual: session.revision,
          });
        const index = await store.readIndex(session);
        const selectedEntries = matchingEntries(index, input.selector);
        const unsupportedFileIds = new Set(
          index.files
            .filter((file) => file.kind === "inline-unsupported")
            .map((file) => file.id),
        );
        const entries = selectedEntries.filter(
          (entry) => !unsupportedFileIds.has(entry.fileId),
        );
        if (selectedEntries.length > 0 && entries.length === 0)
          throw new VsnapError(
            "INLINE_SNAPSHOT_UNSUPPORTED",
            "Inline snapshot changes are captured as evidence but cannot be approved or applied in v1",
          );
        const supportedEntryIds = new Set(entries.map((entry) => entry.id));
        const ids = input.selector.startsWith("hunk_")
          ? [input.selector]
          : index.hunks
              .filter((hunk) => supportedEntryIds.has(hunk.entryId))
              .map((hunk) => hunk.id);
        if (ids.length === 0)
          throw new VsnapError("SELECTOR_NOT_FOUND", input.selector);
        const decisions = await store.readDecisions(session);
        for (const id of ids) decisions[id] = input.decision;
        await store.writeDecisions(session, decisions);
        await store.appendAudit(session, "decision.set", {
          selector: input.selector,
          decision: input.decision,
          hunks: ids,
        });
        return {
          sessionId: session.id,
          revision: session.revision,
          affectedHunks: ids,
          decision: input.decision,
        };
      });
    },
    async createPreview(input: CreatePreviewInput): Promise<ApplyPlan> {
      const session = await store.load(input.sessionId);
      return (await prepareApply(session, input.expectedRevision)).plan;
    },
    async apply(input: ApplyInput): Promise<ApplyResult> {
      const unlockedSession = await store.load(input.sessionId);
      return store.withSessionLock(unlockedSession, async () => {
        let session = await store.load(input.sessionId);
        const { plan, index, synthesized } = await prepareApply(
          session,
          input.expectedRevision,
        );
        if (plan.acceptedHunks.length === 0 && plan.rejectedHunks.length === 0)
          return {
            code: "NO_DECISIONS",
            sessionId: session.id,
            revision: session.revision,
            written: [],
            remaining: plan.pendingHunks.length,
          };
        session = { ...session, state: "applying" };
        await store.save(session);
        const oldHunks = index.hunks.map((h) => h.id);
        const written = await applyFilesystemPlan(session, plan, store);
        await mapConcurrent(synthesized, 16, async (file) => {
          const absolute = `${session.repositoryRoot}/${file.relativePath}`;
          await Promise.all([
            writeOverlay(
              store.sessionDirectory(session),
              "baseline",
              absolute,
              file.accepted,
            ),
            writeOverlay(
              store.sessionDirectory(session),
              "candidate",
              absolute,
              file.remaining,
            ),
          ]);
        });
        session = {
          ...session,
          revision: session.revision + 1,
          state: "completed",
        };
        await store.writeDecisions(session, {});
        await rebuildReviewIndex(session, store);
        const remainingIndex = await store.readIndex(session);
        if (remainingIndex.hunks.length === 0)
          session = {
            ...session,
            state: "applied",
            completedAt: clock().toISOString(),
          };
        session = {
          ...session,
          summary: {
            ...session.summary,
            snapshotChanges: remainingIndex.entries.length,
          },
        };
        await store.save(session);
        await store.appendAudit(session, "apply.rebase", {
          planId: plan.id,
          oldHunks,
          newHunks: remainingIndex.hunks.map((h) => h.id),
          written,
        });
        return {
          code: written.length > 0 ? "APPLIED" : "REBASED",
          sessionId: session.id,
          revision: session.revision,
          written,
          remaining: remainingIndex.hunks.length,
        };
      });
    },
    async verify(input: VerifyInput) {
      const source = await store.load(input.sessionId);
      const child = await store.create(
        source.repositoryRoot,
        input.vitestArgs ?? source.vitestArgs,
        source.id,
      );
      return store.withSessionLock(child, () =>
        runVitestCapture({
          session: child,
          store,
          ...(options.environmentPath
            ? { environmentPath: options.environmentPath }
            : {}),
        }),
      );
    },
    async *subscribe(
      sessionId: string,
      options?: { afterSequence?: number },
    ): AsyncIterable<RunEvent> {
      const session = await store.load(sessionId);
      let sequence = options?.afterSequence ?? 0;
      let offset = 0;
      while (true) {
        const chunk = await store.readEventChunk(session, offset);
        offset = chunk.offset;
        const events = chunk.events.filter(
          (event) => event.sequence > sequence,
        );
        for (const event of events) {
          sequence = event.sequence;
          yield event;
        }
        const current = await store.load(sessionId);
        if (
          ["completed", "failed", "interrupted", "applied"].includes(
            current.state,
          ) &&
          events.length === 0
        )
          return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
    async *subscribeProgress(sessionId: string): AsyncIterable<RunProgress> {
      const session = await store.load(sessionId);
      const progress = createProgressAccumulator(sessionId);
      let offset = 0;
      while (true) {
        const chunk = await store.readEventChunk(session, offset);
        offset = chunk.offset;
        for (const event of chunk.events) accumulateProgress(progress, event);
        if (chunk.events.length > 0) yield progressSnapshot(progress);
        const current = await store.load(sessionId);
        if (
          ["completed", "failed", "interrupted", "applied"].includes(
            current.state,
          ) &&
          chunk.events.length === 0
        )
          return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
  };
  return application;
}
