import type { ReviewNode } from "@vsnap/protocol";
import { useEffect } from "react";

export const RERUN_PROGRESS_WARNING =
  "Your accepted and rejected decisions haven't been applied. Rerunning starts a fresh review. Continue without applying them?";

export function hasUnappliedReviewProgress(
  nodes: readonly ReviewNode[],
): boolean {
  return nodes.some((node) => node.decision !== "pending");
}

export function preventProgressLoss(event: BeforeUnloadEvent): void {
  event.preventDefault();
  event.returnValue = true;
}

export function useProgressLossWarning(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    window.addEventListener("beforeunload", preventProgressLoss);
    return () =>
      window.removeEventListener("beforeunload", preventProgressLoss);
  }, [enabled]);
}
