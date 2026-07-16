// @vitest-environment jsdom
import type { ReviewNode } from "@vsnap/protocol";
import { describe, expect, it } from "vitest";
import {
  hasUnappliedReviewProgress,
  preventProgressLoss,
} from "./review-progress.js";

function node(decision: ReviewNode["decision"]): ReviewNode {
  return {
    id: "family_test",
    kind: "family",
    label: "change",
    decision,
    childCount: 1,
  };
}

describe("review progress loss protection", () => {
  it("warns for accepted, rejected, and mixed decisions", () => {
    expect(hasUnappliedReviewProgress([node("pending")])).toBe(false);
    expect(hasUnappliedReviewProgress([node("accepted")])).toBe(true);
    expect(hasUnappliedReviewProgress([node("rejected")])).toBe(true);
    expect(hasUnappliedReviewProgress([node("mixed")])).toBe(true);
  });

  it("cancels a page unload", () => {
    const event = new Event("beforeunload", {
      cancelable: true,
    }) as BeforeUnloadEvent;
    preventProgressLoss(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
