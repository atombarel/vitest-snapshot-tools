import { stat } from "node:fs/promises";
import {
  applyAcceptedHunks,
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
  GetDiffInput,
  ListNodesInput,
  ListSessionsInput,
  Page,
  RerunInput,
  ReviewNode,
  ReviewSession,
  RunEvent,
  SessionSummary,
  SetDecisionInput,
  SnapshotApplication,
  StartRunInput,
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

export interface SnapshotApplicationOptions extends SessionStoreOptions {
  store?: SessionStore;
  clock?: () => Date;
  logger?: Pick<Console, "info" | "warn" | "error">;
  environmentPath?: string;
}

export function createSnapshotApplication(
  options: SnapshotApplicationOptions = {},
): SnapshotApplication {
  const store = options.store ?? new SessionStore(options);
  const clock = options.clock ?? (() => new Date());
  const controllers = new Map<string, AbortController>();

  async function entryValues(
    session: ReviewSession,
    entry: StoredReviewEntry,
  ): Promise<{ baseline: string; candidate: string }> {
    return {
      baseline: (await store.readBlob(session, entry.baselineBlob)) ?? "",
      candidate: (await store.readBlob(session, entry.candidateBlob)) ?? "",
    };
  }
  async function entryDiff(session: ReviewSession, entry: StoredReviewEntry) {
    const values = await entryValues(session, entry);
    const decisions = await store.readDecisions(session);
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

  async function synthesizedFiles(session: ReviewSession): Promise<
    Array<{
      relativePath: string;
      baseline: string | null;
      accepted: string | null;
      remaining: string | null;
    }>
  > {
    const index = await store.readIndex(session);
    const result = [];
    for (const file of index.files) {
      if (file.kind === "inline-unsupported") continue;
      const absolute = `${session.repositoryRoot}/${file.relativePath}`;
      const baseline =
        (await readOverlay(
          store.sessionDirectory(session),
          "baseline",
          absolute,
        )) ?? null;
      const candidate =
        (await readOverlay(
          store.sessionDirectory(session),
          "candidate",
          absolute,
        )) ?? null;
      const entries = index.entries.filter((entry) => entry.fileId === file.id);
      const acceptedValues = new Map<string, string | null>();
      const remainingValues = new Map<string, string | null>();
      for (const entry of entries) {
        const diff = await entryDiff(session, entry);
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
            ? applyAcceptedHunks(await entryDiff(session, entries[0]))
            : baseline
          : synthesizeSnapshotFile(baseline, acceptedValues);
      let remaining: string | null;
      if (file.parseMode === "opaque") {
        const first = entries[0];
        const diff = first ? await entryDiff(session, first) : null;
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
      result.push({
        relativePath: file.relativePath,
        baseline,
        accepted,
        remaining,
      });
    }
    return result;
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
      return runVitestCapture({
        session: child,
        store,
        ...(options.environmentPath
          ? { environmentPath: options.environmentPath }
          : {}),
      });
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
      const hunksFor = (entryIds: string[]) =>
        index.hunks
          .filter((hunk) => entryIds.includes(hunk.entryId))
          .map((hunk) => ({
            ...hunk,
            decision: decisions[hunk.id] ?? ("pending" as const),
          }));
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
          const id = stableId(
            "test",
            entry.fileId,
            entry.testName ?? entry.key,
          );
          groups.set(id, [...(groups.get(id) ?? []), entry]);
        }
        for (const [id, entries] of groups) {
          const first = entries[0];
          if (!first) continue;
          nodes.push({
            id,
            kind: "test",
            parentId: first.fileId,
            label: first.testName ?? first.key,
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
      const limit = Math.min(input.limit ?? 200, 500);
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
                  ...(Array.isArray(testEvent?.payload.failures)
                    ? { failureCount: testEvent.payload.failures.length }
                    : {}),
                },
              }
            : {}),
        },
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
        const ids = input.selector.startsWith("hunk_")
          ? [input.selector]
          : index.hunks
              .filter((hunk) =>
                entries.some((entry) => entry.id === hunk.entryId),
              )
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
      if (
        input.expectedRevision !== undefined &&
        input.expectedRevision !== session.revision
      )
        throw new VsnapError("STALE_REVISION", "Session revision changed");
      const index = await store.readIndex(session);
      const decisions = await store.readDecisions(session);
      const operations = [];
      let patch = "";
      for (const file of await synthesizedFiles(session)) {
        if (file.accepted === file.baseline) continue;
        const contentBlob =
          file.accepted === null
            ? undefined
            : await store.writeBlob(session, file.accepted);
        const mode = await stat(
          `${session.repositoryRoot}/${file.relativePath}`,
        )
          .then((value) => value.mode)
          .catch(() => undefined);
        if (file.baseline === null && contentBlob)
          operations.push({
            type: "create" as const,
            relativePath: file.relativePath,
            expectedHash: null,
            contentBlob,
          });
        else if (file.accepted === null && file.baseline !== null)
          operations.push({
            type: "delete" as const,
            relativePath: file.relativePath,
            expectedHash: sha256(file.baseline),
          });
        else if (contentBlob && file.baseline !== null)
          operations.push({
            type: "update" as const,
            relativePath: file.relativePath,
            expectedHash: sha256(file.baseline),
            contentBlob,
            ...(mode === undefined ? {} : { mode }),
          });
        patch += unifiedFilePatch(
          file.relativePath,
          file.baseline ?? "",
          file.accepted ?? "",
        );
      }
      return {
        id: stableId("plan", session.id, session.revision, patch),
        sessionId: session.id,
        expectedRevision: session.revision,
        createdAt: clock().toISOString(),
        operations,
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
      };
    },
    async apply(input: ApplyInput): Promise<ApplyResult> {
      const unlockedSession = await store.load(input.sessionId);
      return store.withSessionLock(unlockedSession, async () => {
        let session = await store.load(input.sessionId);
        const plan = await application.createPreview({
          sessionId: input.sessionId,
          ...(input.expectedRevision === undefined
            ? {}
            : { expectedRevision: input.expectedRevision }),
        });
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
        const oldHunks = (await store.readIndex(session)).hunks.map(
          (h) => h.id,
        );
        const synthesized = await synthesizedFiles(session);
        const written = await applyFilesystemPlan(session, plan, store);
        for (const file of synthesized) {
          const absolute = `${session.repositoryRoot}/${file.relativePath}`;
          await writeOverlay(
            store.sessionDirectory(session),
            "baseline",
            absolute,
            file.accepted,
          );
          await writeOverlay(
            store.sessionDirectory(session),
            "candidate",
            absolute,
            file.remaining,
          );
        }
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
      while (true) {
        const events = await store.readEvents(session, sequence);
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
  };
  return application;
}
