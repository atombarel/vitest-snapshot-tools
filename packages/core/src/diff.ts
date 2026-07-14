import type { Decision, DiffHunk, EntryDiff } from "@vsnap/protocol";
import { createTwoFilesPatch, structuredPatch } from "diff";
import { sha256, stableId } from "./hash.js";

export interface TextHunk extends DiffHunk {
  lines: string[];
}
export interface TextEntryDiff
  extends Pick<EntryDiff, "entryId" | "baseline" | "candidate"> {
  hunks: TextHunk[];
}

function compactPreview(value: string, limit = 72): string {
  const compact = value.trim().replace(/\s+/g, " ");
  return compact.length <= limit ? compact : `${compact.slice(0, limit - 1)}…`;
}

/** Describe the exact changed lines without including surrounding diff context. */
export function summarizeHunk(lines: readonly string[]): string {
  const removed = lines
    .filter((line) => line.startsWith("-") && !line.startsWith("---"))
    .map((line) => compactPreview(line.slice(1)))
    .filter(Boolean);
  const added = lines
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => compactPreview(line.slice(1)))
    .filter(Boolean);
  if (removed.length === 1 && added.length === 1)
    return `${removed[0]} → ${added[0]}`;
  if (removed.length === 0 && added.length === 1) return `Added ${added[0]}`;
  if (added.length === 0 && removed.length === 1)
    return `Removed ${removed[0]}`;
  if (removed.length === 0) return `Added ${added.length} lines`;
  if (added.length === 0) return `Removed ${removed.length} lines`;
  return `${removed.length} removed · ${added.length} added`;
}

/** Fingerprint only changed lines so identical edits group across varied context. */
export function exactChangeHash(lines: readonly string[]): string {
  return sha256(
    lines
      .filter(
        (line) =>
          (line.startsWith("+") && !line.startsWith("+++")) ||
          (line.startsWith("-") && !line.startsWith("---")),
      )
      .join("\n"),
  );
}

export function createEntryDiff(
  entryId: string,
  baseline = "",
  candidate = "",
  decisions: Readonly<Record<string, Decision>> = {},
): TextEntryDiff {
  const patch = structuredPatch(
    "baseline",
    "candidate",
    baseline,
    candidate,
    undefined,
    undefined,
    { context: 3 },
  );
  const hunks = patch.hunks.map((hunk) => {
    const contentHash = sha256(hunk.lines.join("\n"));
    const id = stableId(
      "hunk",
      entryId,
      hunk.oldStart,
      hunk.oldLines,
      hunk.newStart,
      hunk.newLines,
      contentHash,
    );
    return {
      id,
      entryId,
      oldStart: hunk.oldStart,
      oldLines: hunk.oldLines,
      newStart: hunk.newStart,
      newLines: hunk.newLines,
      contentHash,
      changeHash: exactChangeHash(hunk.lines),
      summary: summarizeHunk(hunk.lines),
      decision: decisions[id] ?? "pending",
      lines: hunk.lines,
    } satisfies TextHunk;
  });
  return { entryId, baseline, candidate, hunks };
}

function splitLines(value: string): { lines: string[]; newline: string } {
  const newline = value.includes("\r\n") ? "\r\n" : "\n";
  const normalized = value.replace(/\r\n/g, "\n");
  return {
    lines: normalized.endsWith("\n")
      ? normalized.slice(0, -1).split("\n")
      : normalized.split("\n"),
    newline,
  };
}

/** Apply only accepted unified hunks; rejected and pending hunks retain baseline text. */
export function applyAcceptedHunks(diff: TextEntryDiff): string {
  const source = splitLines(diff.baseline);
  if (diff.hunks.length === 0) return diff.baseline;
  const output: string[] = [];
  let cursor = 0;
  for (const hunk of diff.hunks) {
    const start = Math.max(0, hunk.oldStart - 1);
    output.push(...source.lines.slice(cursor, start));
    if (hunk.decision === "accepted") {
      for (const line of hunk.lines)
        if (!line.startsWith("-") && !line.startsWith("\\"))
          output.push(line.slice(1));
    } else {
      for (const line of hunk.lines)
        if (!line.startsWith("+") && !line.startsWith("\\"))
          output.push(line.slice(1));
    }
    cursor = start + hunk.oldLines;
  }
  output.push(...source.lines.slice(cursor));
  const hasTrailing =
    diff.baseline.endsWith("\n") ||
    (diff.hunks.every((h) => h.decision === "accepted") &&
      diff.candidate.endsWith("\n"));
  return `${output.join(source.newline)}${hasTrailing ? source.newline : ""}`;
}

export function unifiedFilePatch(
  path: string,
  baseline: string,
  result: string,
): string {
  if (baseline === result) return "";
  return createTwoFilesPatch(
    `a/${path}`,
    `b/${path}`,
    baseline,
    result,
    undefined,
    undefined,
    { context: 3 },
  );
}
