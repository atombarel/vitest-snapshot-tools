import type { Decision, DerivedDecision, DiffHunk } from "@vsnap/protocol";

export function deriveDecision(
  descendants: readonly Pick<DiffHunk, "decision">[],
): DerivedDecision {
  if (
    descendants.length === 0 ||
    descendants.some((hunk) => hunk.decision === "pending")
  )
    return "pending";
  const first = descendants[0]?.decision;
  return descendants.every((hunk) => hunk.decision === first)
    ? (first ?? "pending")
    : "mixed";
}

export function cascadeDecision<T extends DiffHunk>(
  hunks: readonly T[],
  decision: Decision,
): T[] {
  return hunks.map((hunk) => ({ ...hunk, decision }));
}

export function decisionCounts(
  hunks: readonly Pick<DiffHunk, "decision">[],
): Record<Decision, number> {
  const counts: Record<Decision, number> = {
    pending: 0,
    accepted: 0,
    rejected: 0,
  };
  for (const hunk of hunks) counts[hunk.decision] += 1;
  return counts;
}
