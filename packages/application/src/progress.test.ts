import type { RunEvent } from "@vsnap/protocol";
import { describe, expect, it } from "vitest";
import {
  accumulateProgress,
  createProgressAccumulator,
  progressSnapshot,
} from "./progress.js";

const sessionId = "4d743cfe-85f1-419a-b437-799ca6ce7476";

function event(
  sequence: number,
  type: RunEvent["type"],
  payload: Record<string, unknown>,
): RunEvent {
  return {
    schemaVersion: 1,
    sequence,
    sessionId,
    type,
    timestamp: "2026-07-15T00:00:00.000Z",
    payload,
  };
}

describe("backend run progress", () => {
  it("aggregates execution and snapshot-review outcomes separately", () => {
    const progress = createProgressAccumulator(sessionId);
    const events = [
      event(1, "module.collected", { id: "module", tests: 2 }),
      event(2, "test.started", { id: "one", name: "first" }),
      event(3, "test.finished", {
        id: "one",
        name: "first",
        status: "passed",
        durationMs: 12,
      }),
      event(4, "test.finished", {
        id: "two",
        name: "second",
        status: "passed",
        durationMs: 8,
      }),
      event(5, "snapshot.diff-ready", { entryId: "entry_changed" }),
      event(6, "snapshot.diff-ready", { entryId: "entry_changed" }),
      event(7, "module.finished", { id: "module" }),
      event(8, "run.finished", {}),
    ];
    for (const item of events) accumulateProgress(progress, item);

    expect(progressSnapshot(progress)).toMatchObject({
      sequence: 8,
      modulesCollected: 1,
      modulesFinished: 1,
      testsDiscovered: 2,
      testsFinished: 2,
      passed: 2,
      failed: 0,
      snapshotChanges: 1,
      currentTests: [],
      runEnded: true,
    });
  });

  it("tracks current tests and ignores replayed event sequences", () => {
    const progress = createProgressAccumulator(sessionId);
    const started = event(1, "test.started", {
      id: "one",
      name: "currently running",
    });
    accumulateProgress(progress, started);
    accumulateProgress(progress, started);
    expect(progressSnapshot(progress)).toMatchObject({
      sequence: 1,
      currentTests: [{ id: "one", name: "currently running" }],
      testsFinished: 0,
    });
  });
});
