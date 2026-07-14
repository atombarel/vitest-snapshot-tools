import type { RunEvent } from "@vsnap/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { beginLiveSession, liveStore, reduceEvent } from "./store.js";

const sessionA = "4d743cfe-85f1-419a-b437-799ca6ce7476";
const sessionB = "15cc1dd3-b90d-4e30-9e8c-935492818b2d";

function event(
  sequence: number,
  type: RunEvent["type"],
  payload: Record<string, unknown>,
): RunEvent {
  return {
    schemaVersion: 1,
    sequence,
    sessionId: sessionA,
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

  it("resets live history when navigating to another session", () => {
    beginLiveSession(sessionA);
    reduceEvent(event(1, "console.output", { content: "old output" }));
    expect(beginLiveSession(sessionA)).toBe(1);
    expect(beginLiveSession(sessionB)).toBe(0);
    expect(liveStore.state.events).toEqual([]);
    expect(liveStore.state.console).toEqual([]);
  });

  it("ignores a late event from a previous session", () => {
    beginLiveSession(sessionB);
    reduceEvent(event(1, "test.started", { id: "stale", name: "old test" }));
    expect(liveStore.state.sequence).toBe(0);
    expect(liveStore.state.runningTests).toEqual({});
  });
});
