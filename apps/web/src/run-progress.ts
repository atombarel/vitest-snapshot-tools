import type { RunEvent, RunState } from "@vsnap/protocol";

export interface FinishedTestActivity {
  id: string;
  name: string;
  status: string;
  durationMs: number;
}

export interface RunProgressSummary {
  phase: string;
  modulesCollected: number;
  modulesFinished: number;
  testsDiscovered: number;
  testsFinished: number;
  passed: number;
  failed: number;
  skipped: number;
  snapshotChanges: number;
  recentTests: FinishedTestActivity[];
}

function numericPayload(event: RunEvent, key: string): number {
  const value = event.payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function phaseFor(
  state: RunState,
  testsDiscovered: number,
  testsFinished: number,
  runEnded: boolean,
): string {
  if (state === "created") return "Starting Vitest";
  if (state === "collecting") return "Discovering test files";
  if (state === "cancelling") return "Stopping the test run";
  if (state === "failed") return "Test run failed";
  if (state === "interrupted") return "Test run interrupted";
  if (state === "completed") return "Snapshot review ready";
  if (state === "applied") return "Snapshot changes applied";
  if (state === "applying") return "Applying accepted changes";
  if (runEnded || (testsDiscovered > 0 && testsFinished >= testsDiscovered))
    return "Preparing snapshot review";
  if (testsDiscovered === 0) return "Collecting tests";
  return "Running tests";
}

export function summarizeRunProgress(
  events: RunEvent[],
  state: RunState,
): RunProgressSummary {
  const collectedModules = new Map<string, number>();
  const finishedModules = new Set<string>();
  const finishedTests = new Map<string, FinishedTestActivity>();
  const snapshotEntries = new Set<string>();
  let runEnded = false;

  for (const event of events) {
    const id = String(event.payload.id ?? event.payload.moduleId ?? "");
    if (event.type === "module.collected" && id)
      collectedModules.set(id, numericPayload(event, "tests"));
    if (event.type === "module.finished" && id) finishedModules.add(id);
    if (event.type === "test.finished" && id) {
      finishedTests.set(id, {
        id,
        name: String(event.payload.name ?? "Unnamed test"),
        status: String(event.payload.status ?? "unknown"),
        durationMs: numericPayload(event, "durationMs"),
      });
    }
    if (event.type === "snapshot.diff-ready") {
      const entryId = String(event.payload.entryId ?? "");
      if (entryId) snapshotEntries.add(entryId);
    }
    if (["run.finished", "run.failed", "run.interrupted"].includes(event.type))
      runEnded = true;
  }

  const testsDiscovered = [...collectedModules.values()].reduce(
    (total, count) => total + count,
    0,
  );
  const tests = [...finishedTests.values()];
  const countStatus = (status: string) =>
    tests.filter((test) => test.status === status).length;

  return {
    phase: phaseFor(state, testsDiscovered, tests.length, runEnded),
    modulesCollected: collectedModules.size,
    modulesFinished: finishedModules.size,
    testsDiscovered,
    testsFinished: tests.length,
    passed: countStatus("passed"),
    failed: countStatus("failed"),
    skipped: countStatus("skipped") + countStatus("pending"),
    snapshotChanges: snapshotEntries.size,
    recentTests: tests.slice(-3).reverse(),
  };
}

export function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0
    ? `${minutes}m ${String(seconds).padStart(2, "0")}s`
    : `${seconds}s`;
}
