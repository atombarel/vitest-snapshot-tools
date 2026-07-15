import type { ReviewSession, RunEvent } from "@vsnap/protocol";
import type { SessionStore } from "@vsnap/session";
import { describe, expect, it, vi } from "vitest";
import { BufferedRunEventWriter } from "./event-writer.js";

function event(sequence: number): RunEvent {
  return {
    schemaVersion: 1,
    sequence,
    sessionId: "session-1",
    type: "test.started",
    timestamp: "2026-01-01T00:00:00.000Z",
    payload: {},
  };
}

describe("BufferedRunEventWriter", () => {
  it("persists ordered event batches instead of one append per event", async () => {
    const batches: number[][] = [];
    const store = {
      appendEvents: vi.fn(async (_session, events: readonly RunEvent[]) => {
        batches.push(events.map((value) => value.sequence));
      }),
    } as unknown as SessionStore;
    const writer = new BufferedRunEventWriter(
      store,
      { id: "session-1" } as ReviewSession,
      3,
      60_000,
    );

    for (let sequence = 1; sequence <= 5; sequence++)
      writer.append(event(sequence));
    await writer.close();

    expect(batches).toEqual([
      [1, 2, 3],
      [4, 5],
    ]);
  });
});
