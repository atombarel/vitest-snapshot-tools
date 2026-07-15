import { Store } from "@tanstack/store";
import type { RunProgress } from "@vsnap/protocol";

export interface LiveState {
  sessionId?: string;
  sequence: number;
  progress?: RunProgress;
}
export const liveStore = new Store<LiveState>({ sequence: 0 });

export function beginLiveSession(sessionId: string): void {
  if (liveStore.state.sessionId === sessionId) return;
  liveStore.setState(() => ({ sessionId, sequence: 0 }));
}

export function reduceProgress(progress: RunProgress): void {
  liveStore.setState((state) => {
    if (
      (state.sessionId && state.sessionId !== progress.sessionId) ||
      progress.sequence <= state.sequence
    )
      return state;
    return {
      sessionId: progress.sessionId,
      sequence: progress.sequence,
      progress,
    };
  });
}
