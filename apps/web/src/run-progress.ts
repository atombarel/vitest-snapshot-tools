import type { RunProgress, RunState } from "@vsnap/protocol";

export function createEmptyRunProgress(sessionId: string): RunProgress {
  return {
    schemaVersion: 1,
    sessionId,
    sequence: 0,
    modulesCollected: 0,
    modulesFinished: 0,
    testsDiscovered: 0,
    testsFinished: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    snapshotChanges: 0,
    currentTests: [],
    recentTests: [],
    runEnded: false,
  };
}

export function progressPhase(progress: RunProgress, state: RunState): string {
  if (state === "created") return "Starting Vitest";
  if (state === "collecting") return "Discovering test files";
  if (state === "cancelling") return "Stopping the test run";
  if (state === "failed") return "Test run failed";
  if (state === "interrupted") return "Test run interrupted";
  if (state === "completed") return "Snapshot review ready";
  if (state === "applied") return "Snapshot changes applied";
  if (state === "applying") return "Applying accepted changes";
  if (
    progress.runEnded ||
    (progress.testsDiscovered > 0 &&
      progress.testsFinished >= progress.testsDiscovered)
  )
    return "Preparing snapshot review";
  if (progress.testsDiscovered === 0) return "Collecting tests";
  return "Running tests";
}

export function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0
    ? `${minutes}m ${String(seconds).padStart(2, "0")}s`
    : `${seconds}s`;
}
