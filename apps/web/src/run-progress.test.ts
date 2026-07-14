import type { RunEvent } from "@vsnap/protocol";
import { describe, expect, it } from "vitest";
import { formatElapsed, summarizeRunProgress } from "./run-progress.js";

function event(
  sequence: number,
  type: RunEvent["type"],
  payload: Record<string, unknown>,
): RunEvent {
  return {
    schemaVersion: 1,
    sequence,
    sessionId: "4d743cfe-85f1-419a-b437-799ca6ce7476",
    type,
    timestamp: "2026-07-13T00:00:00.000Z",
    payload,
  };
}

describe("run progress", () => {
  it("counts discovered and finished work without double-counting index events", () => {
    const summary = summarizeRunProgress(
      [
        event(1, "module.collected", { id: "a", tests: 2 }),
        event(2, "module.collected", { id: "b", tests: 3 }),
        event(3, "test.finished", {
          id: "one",
          name: "suite > one",
          status: "passed",
          durationMs: 12,
        }),
        event(4, "test.finished", {
          id: "two",
          name: "suite > two",
          status: "failed",
          durationMs: 8,
        }),
        event(5, "snapshot.diff-ready", { entryId: "entry_1" }),
        event(6, "snapshot.diff-ready", { entryId: "entry_1" }),
        event(7, "module.finished", { id: "a" }),
      ],
      "running",
    );

    expect(summary).toMatchObject({
      phase: "Running tests",
      modulesCollected: 2,
      modulesFinished: 1,
      testsDiscovered: 5,
      testsFinished: 2,
      passed: 1,
      failed: 1,
      snapshotChanges: 1,
    });
    expect(summary.recentTests[0]?.name).toBe("suite > two");
  });

  it("shows post-test processing as a distinct phase", () => {
    const summary = summarizeRunProgress(
      [
        event(1, "module.collected", { id: "a", tests: 1 }),
        event(2, "test.finished", { id: "one", status: "passed" }),
        event(3, "run.finished", {}),
      ],
      "running",
    );
    expect(summary.phase).toBe("Preparing snapshot review");
  });

  it("formats short and minute-scale elapsed times", () => {
    expect(formatElapsed(9_900)).toBe("9s");
    expect(formatElapsed(69_000)).toBe("1m 09s");
  });
});
