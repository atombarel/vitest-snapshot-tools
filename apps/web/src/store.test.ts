import type { RunEvent } from "@vsnap/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { liveStore, reduceEvent } from "./store.js";

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

describe("live event reduction", () => {
  beforeEach(() =>
    liveStore.setState(() => ({
      sequence: 0,
      events: [],
      runningTests: {},
      console: [],
    })),
  );

  it("tracks running tests and bounded console history", () => {
    reduceEvent(event(1, "test.started", { id: "test_1", name: "works" }));
    expect(liveStore.state.runningTests).toEqual({ test_1: "works" });
    reduceEvent(event(2, "console.output", { content: "hello" }));
    reduceEvent(event(3, "test.finished", { id: "test_1" }));
    expect(liveStore.state.sequence).toBe(3);
    expect(liveStore.state.runningTests).toEqual({});
    expect(liveStore.state.console).toHaveLength(1);
  });
});
