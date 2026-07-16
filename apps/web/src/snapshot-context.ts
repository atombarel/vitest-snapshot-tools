import type { EntryDiff } from "@vsnap/protocol";

export function matcherInvocation(context: EntryDiff["context"]): string {
  if (context.snapshotName)
    return `${context.matcher}(${JSON.stringify(context.snapshotName)})`;
  return `${context.matcher} #${context.ordinal ?? 1}`;
}

export function snapshotTitle(
  context: EntryDiff["context"],
  fallbackOrdinal: number,
): string {
  if (context.snapshotName) return context.snapshotName;
  const testName = context.test?.name?.trim();
  if (testName) {
    const separator = testName.lastIndexOf(" > ");
    const leaf = testName.slice(separator < 0 ? 0 : separator + 3).trim();
    if (leaf) return leaf;
  }
  return `Snapshot ${fallbackOrdinal}`;
}
