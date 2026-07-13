import type { EntryDiff } from "@vsnap/protocol";

export function matcherInvocation(context: EntryDiff["context"]): string {
  if (context.snapshotName)
    return `${context.matcher}(${JSON.stringify(context.snapshotName)})`;
  return `${context.matcher} #${context.ordinal ?? 1}`;
}
