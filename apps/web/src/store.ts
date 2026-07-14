import { Store } from "@tanstack/store";
import type { RunEvent } from "@vsnap/protocol";

export interface LiveState {
  sessionId?: string;
  sequence: number;
  events: RunEvent[];
  runningTests: Record<string, string>;
  console: RunEvent[];
}
export const liveStore = new Store<LiveState>({
  sequence: 0,
  events: [],
  runningTests: {},
  console: [],
});
export function beginLiveSession(sessionId: string): number {
  if (liveStore.state.sessionId === sessionId) return liveStore.state.sequence;
  liveStore.setState(() => ({
    sessionId,
    sequence: 0,
    events: [],
    runningTests: {},
    console: [],
  }));
  return 0;
}
export function reduceEvent(event: RunEvent): void {
  liveStore.setState((state) => {
    if (state.sessionId && state.sessionId !== event.sessionId) return state;
    const runningTests = { ...state.runningTests };
    if (event.type === "test.started")
      runningTests[String(event.payload.id)] = String(event.payload.name);
    if (event.type === "test.finished")
      delete runningTests[String(event.payload.id)];
    return {
      sessionId: event.sessionId,
      sequence: event.sequence,
      events: [...state.events.slice(-999), event],
      runningTests,
      console:
        event.type === "console.output"
          ? [...state.console.slice(-199), event]
          : state.console,
    };
  });
}
