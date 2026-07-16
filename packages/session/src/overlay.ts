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
  testId?: string;
  testFile?: string;
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  visit: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < values.length) {
      const index = next++;
      const value = values[index];
      if (value !== undefined) results[index] = await visit(value);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, worker),
  );
  return results;
}
export function overlayKey(path: string): string {
  return sha256(path);
}

export async function writeOverlay(
  directory: string,
  side: "baseline" | "candidate",
  path: string,
  content: string | null,
  provenance?: { testId?: string; testFile?: string },
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
      ...provenance,
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
  Array<{
    path: string;
    baseline: string | null;
    candidate: string | null;
    testId?: string;
    testFile?: string;
  }>
> {
  const candidateDirectory = join(sessionDirectory, "candidate");
  const files = await import("node:fs/promises")
    .then((fs) => fs.readdir(candidateDirectory))
    .catch(() => []);
  return mapConcurrent(
    files.filter((name) => name.endsWith(".json")),
    16,
    async (name) => {
      const record = JSON.parse(
        await readFile(join(candidateDirectory, name), "utf8"),
      ) as OverlayRecord;
      const [baseline, candidate] = await Promise.all([
        readOverlay(sessionDirectory, "baseline", record.path),
        readOverlay(sessionDirectory, "candidate", record.path),
      ]);
      return {
        path: record.path,
        baseline: baseline ?? null,
        candidate: candidate ?? null,
        ...(record.testId ? { testId: record.testId } : {}),
        ...(record.testFile ? { testFile: record.testFile } : {}),
      };
    },
  );
}
