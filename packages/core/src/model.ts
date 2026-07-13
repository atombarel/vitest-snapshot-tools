import type { ChangeType, SnapshotEntry, SnapshotFile } from "@vsnap/protocol";
import {
  blobHash,
  parseSnapshotFile,
  snapshotEntryId,
  snapshotFileId,
} from "./parser.js";

export interface IndexedEntry extends SnapshotEntry {
  baseline?: string;
  candidate?: string;
}
export interface IndexedSnapshot {
  file: SnapshotFile;
  entries: IndexedEntry[];
}

function changeType(
  baseline: string | undefined,
  candidate: string | undefined,
): ChangeType {
  if (baseline === undefined) return "added";
  if (candidate === undefined) return "deleted";
  return "modified";
}

export function indexSnapshot(
  relativePath: string,
  baseline: string | null,
  candidate: string | null,
  kind: "external" | "file" | "inline-unsupported" = "external",
  provenance?: { testId?: string; testFile?: string },
): IndexedSnapshot {
  const fileId = snapshotFileId(relativePath);
  const baselineParsed = baseline === null ? null : parseSnapshotFile(baseline);
  const candidateParsed =
    candidate === null ? null : parseSnapshotFile(candidate);
  const parseMode =
    kind !== "external" ||
    baselineParsed?.parseMode === "opaque" ||
    candidateParsed?.parseMode === "opaque"
      ? "opaque"
      : "entries";
  const entries: IndexedEntry[] = [];
  if (parseMode === "opaque") {
    entries.push({
      id: snapshotEntryId(relativePath, "<file>"),
      fileId,
      key: "<file>",
      changeType: changeType(baseline ?? undefined, candidate ?? undefined),
      ...(baseline === null ? {} : { baseline }),
      ...(candidate === null ? {} : { candidate }),
    });
  } else {
    const before = new Map(
      (baselineParsed?.entries ?? []).map((entry) => [entry.key, entry]),
    );
    const after = new Map(
      (candidateParsed?.entries ?? []).map((entry) => [entry.key, entry]),
    );
    for (const key of [
      ...new Set([...before.keys(), ...after.keys()]),
    ].sort()) {
      const oldEntry = before.get(key);
      const newEntry = after.get(key);
      if (oldEntry?.value === newEntry?.value) continue;
      const source = newEntry ?? oldEntry;
      if (!source) continue;
      entries.push({
        id: snapshotEntryId(relativePath, key),
        fileId,
        key,
        testName: source.testName,
        ...(source.ordinal === undefined ? {} : { ordinal: source.ordinal }),
        changeType: changeType(oldEntry?.value, newEntry?.value),
        ...(oldEntry ? { baseline: oldEntry.value } : {}),
        ...(newEntry ? { candidate: newEntry.value } : {}),
      });
    }
  }
  return {
    file: {
      id: fileId,
      relativePath,
      kind,
      baselineHash: baseline === null ? null : blobHash(baseline),
      candidateHash: candidate === null ? null : blobHash(candidate),
      changeType: changeType(baseline ?? undefined, candidate ?? undefined),
      parseMode,
      ...provenance,
    },
    entries,
  };
}
