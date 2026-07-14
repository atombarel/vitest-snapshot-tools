import { Store } from "@tanstack/store";
import type { RunEvent } from "@vsnap/protocol";

export interface LiveState {
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
export function reduceEvent(event: RunEvent): void {
  liveStore.setState((state) => {
    const runningTests = { ...state.runningTests };
    if (event.type === "test.started")
      runningTests[String(event.payload.id)] = String(event.payload.name);
    if (event.type === "test.finished")
      delete runningTests[String(event.payload.id)];
    return {
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
