import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { sha256 } from "@vsnap/core";
import type { ReviewSession } from "@vsnap/protocol";
import { atomicWrite, secureMkdir } from "./fs.js";

export interface OverlayRecord {
  schemaVersion: 1;
  path: string;
  contentFile: string;
  deleted: boolean;
}
export function overlayKey(path: string): string {
  return sha256(path);
}

export async function writeOverlay(
  directory: string,
  side: "baseline" | "candidate",
  path: string,
  content: string | null,
): Promise<void> {
  const target = join(directory, side);
  await secureMkdir(target);
  const key = overlayKey(path);
  const contentFile = `${key}.content`;
  if (content !== null) await atomicWrite(join(target, contentFile), content);
  await atomicWrite(
    join(target, `${key}.json`),
    JSON.stringify({
      schemaVersion: 1,
      path,
      contentFile,
      deleted: content === null,
    } satisfies OverlayRecord),
  );
}
export async function readOverlay(
  directory: string,
  side: "baseline" | "candidate",
  path: string,
): Promise<string | null | undefined> {
  const base = join(directory, side);
  const key = overlayKey(path);
  const metadataPath = join(base, `${key}.json`);
  if (!(await stat(metadataPath).catch(() => null))) return undefined;
  const record = JSON.parse(
    await readFile(metadataPath, "utf8"),
  ) as OverlayRecord;
  return record.deleted
    ? null
    : readFile(join(base, record.contentFile), "utf8");
}
export async function listOverlay(
  _session: ReviewSession,
  sessionDirectory: string,
): Promise<
  Array<{ path: string; baseline: string | null; candidate: string | null }>
> {
  const candidateDirectory = join(sessionDirectory, "candidate");
  const records: Array<{
    path: string;
    baseline: string | null;
    candidate: string | null;
  }> = [];
  const files = await import("node:fs/promises")
    .then((fs) => fs.readdir(candidateDirectory))
    .catch(() => []);
  for (const name of files.filter((name) => name.endsWith(".json"))) {
    const record = JSON.parse(
      await readFile(join(candidateDirectory, name), "utf8"),
    ) as OverlayRecord;
    const baseline = await readOverlay(
      sessionDirectory,
      "baseline",
      record.path,
    );
    const candidate = await readOverlay(
      sessionDirectory,
      "candidate",
      record.path,
    );
    records.push({
      path: record.path,
      baseline: baseline ?? null,
      candidate: candidate ?? null,
    });
  }
  return records;
}
