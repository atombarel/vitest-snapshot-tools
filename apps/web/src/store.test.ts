import type { RunProgress } from "@vsnap/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyRunProgress } from "./run-progress.js";
import { beginLiveSession, liveStore, reduceProgress } from "./store.js";

const sessionA = "4d743cfe-85f1-419a-b437-799ca6ce7476";
const sessionB = "15cc1dd3-b90d-4e30-9e8c-935492818b2d";

function progress(
  sequence: number,
  values: Partial<RunProgress> = {},
): RunProgress {
  return { ...createEmptyRunProgress(sessionA), sequence, ...values };
}

describe("live progress reduction", () => {
  beforeEach(() => liveStore.setState(() => ({ sequence: 0 })));

  it("stores the latest backend progress snapshot", () => {
    reduceProgress(
      progress(10, {
        testsDiscovered: 40,
        testsFinished: 12,
        snapshotChanges: 3,
      }),
    );
    expect(liveStore.state.progress).toMatchObject({
      sequence: 10,
      testsDiscovered: 40,
      testsFinished: 12,
      snapshotChanges: 3,
    });
  });

  it("ignores stale and previous-session snapshots", () => {
    beginLiveSession(sessionA);
    reduceProgress(progress(10, { testsFinished: 10 }));
    reduceProgress(progress(9, { testsFinished: 9 }));
    reduceProgress({
      ...progress(11, { testsFinished: 11 }),
      sessionId: sessionB,
    });
    expect(liveStore.state.progress?.testsFinished).toBe(10);
    expect(liveStore.state.sequence).toBe(10);
  });

  it("clears progress when navigating to another session", () => {
    beginLiveSession(sessionA);
    reduceProgress(progress(2, { testsFinished: 2 }));
    beginLiveSession(sessionB);
    expect(liveStore.state).toEqual({ sessionId: sessionB, sequence: 0 });
  });
});
