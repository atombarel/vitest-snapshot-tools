import type { RunEvent, RunProgress } from "@vsnap/protocol";

interface ProgressAccumulator {
  sessionId: string;
  sequence: number;
  collectedModules: Map<string, number>;
  finishedModules: Set<string>;
  testsFinished: number;
  passed: number;
  failed: number;
  skipped: number;
  snapshotEntries: Set<string>;
  currentTests: Map<string, RunProgress["currentTests"][number]>;
  recentTests: RunProgress["recentTests"];
  runEnded: boolean;
}

export function createProgressAccumulator(
  sessionId: string,
): ProgressAccumulator {
  return {
    sessionId,
    sequence: 0,
    collectedModules: new Map(),
    finishedModules: new Set(),
    testsFinished: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    snapshotEntries: new Set(),
    currentTests: new Map(),
    recentTests: [],
    runEnded: false,
  };
}

function numberPayload(event: RunEvent, key: string): number {
  const value = event.payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function accumulateProgress(
  progress: ProgressAccumulator,
  event: RunEvent,
): void {
  if (event.sequence <= progress.sequence) return;
  progress.sequence = event.sequence;
  const id = String(event.payload.id ?? event.payload.moduleId ?? "");
  if (event.type === "module.collected" && id)
    progress.collectedModules.set(id, numberPayload(event, "tests"));
  if (event.type === "module.finished" && id) progress.finishedModules.add(id);
  if (event.type === "test.started" && id)
    progress.currentTests.set(id, {
      id,
      name: String(event.payload.name ?? "Unnamed test"),
    });
  if (event.type === "test.finished" && id) {
    progress.currentTests.delete(id);
    const status = String(event.payload.status ?? "unknown");
    progress.testsFinished++;
    if (status === "passed") progress.passed++;
    if (status === "failed") progress.failed++;
    if (["skipped", "pending"].includes(status)) progress.skipped++;
    progress.recentTests = [
      {
        id,
        name: String(event.payload.name ?? "Unnamed test"),
        status,
        durationMs: numberPayload(event, "durationMs"),
      },
      ...progress.recentTests,
    ].slice(0, 3);
  }
  if (event.type === "snapshot.diff-ready") {
    const entryId = String(event.payload.entryId ?? "");
    if (entryId) progress.snapshotEntries.add(entryId);
  }
  if (["run.finished", "run.failed", "run.interrupted"].includes(event.type))
    progress.runEnded = true;
}

export function progressSnapshot(progress: ProgressAccumulator): RunProgress {
  return {
    schemaVersion: 1,
    sessionId: progress.sessionId,
    sequence: progress.sequence,
    modulesCollected: progress.collectedModules.size,
    modulesFinished: progress.finishedModules.size,
    testsDiscovered: [...progress.collectedModules.values()].reduce(
      (total, count) => total + count,
      0,
    ),
    testsFinished: progress.testsFinished,
    passed: progress.passed,
    failed: progress.failed,
    skipped: progress.skipped,
    snapshotChanges: progress.snapshotEntries.size,
    currentTests: [...progress.currentTests.values()].slice(0, 4),
    recentTests: progress.recentTests,
    runEnded: progress.runEnded,
  };
}
