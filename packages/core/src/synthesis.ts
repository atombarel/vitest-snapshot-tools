import type { ParsedSnapshotFile } from "./parser.js";
import { parseSnapshotFile, serializeSnapshotEntry } from "./parser.js";

/** Minimally rewrite entries in a standard snapshot, preserving unaffected source ranges. */
export function synthesizeSnapshotFile(
  baseline: string | null,
  values: ReadonlyMap<string, string | null>,
): string | null {
  if (baseline === null) {
    const assignments = [...values]
      .filter((item): item is [string, string] => item[1] !== null)
      .map(([key, value]) => serializeSnapshotEntry(key, value));
    return assignments.length === 0 ? null : `${assignments.join("\n\n")}\n`;
  }
  const parsed: ParsedSnapshotFile = parseSnapshotFile(baseline);
  if (parsed.parseMode === "opaque")
    throw new Error("Opaque snapshots require whole-file synthesis");
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  const newline = baseline.includes("\r\n") ? "\r\n" : "\n";
  const serialize = (key: string, value: string) =>
    serializeSnapshotEntry(key, value).replaceAll("\n", newline);
  const seen = new Set<string>();
  for (const entry of parsed.entries) {
    if (!values.has(entry.key)) continue;
    seen.add(entry.key);
    const value = values.get(entry.key);
    if (value === undefined) continue;
    replacements.push({
      start: entry.assignmentStart,
      end: entry.assignmentEnd,
      value: value === null ? "" : serialize(entry.key, value),
    });
  }
  let result = baseline;
  for (const replacement of replacements.sort((a, b) => b.start - a.start))
    result = `${result.slice(0, replacement.start)}${replacement.value}${result.slice(replacement.end)}`;
  const additions = [...values]
    .filter(
      (item): item is [string, string] =>
        !seen.has(item[0]) && item[1] !== null,
    )
    .map(([key, value]) => serialize(key, value));
  if (additions.length > 0)
    result = `${result.trimEnd()}${newline}${newline}${additions.join(`${newline}${newline}`)}${newline}`;
  return result.trim().length === 0 ? null : result;
}
