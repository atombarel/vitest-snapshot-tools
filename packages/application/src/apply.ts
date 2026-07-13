import {
  chmod,
  copyFile,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { assertSafeApplyTarget, sha256 } from "@vsnap/core";
import type { ApplyPlan, FileOperation, ReviewSession } from "@vsnap/protocol";
import { VsnapError } from "@vsnap/protocol";
import type { SessionStore } from "@vsnap/session";
import { atomicWrite } from "@vsnap/session";

interface JournalEntry {
  operation: FileOperation;
  target: string;
  backup?: string;
  temporary?: string;
  started: boolean;
  completed: boolean;
}
interface ApplyJournal {
  schemaVersion: 1;
  planId: string;
  state: "prepared" | "writing" | "rolled-back" | "complete";
  entries: JournalEntry[];
}

async function currentHash(path: string): Promise<string | null> {
  return readFile(path)
    .then((content) => sha256(content))
    .catch((error: NodeJS.ErrnoException) =>
      error.code === "ENOENT" ? null : Promise.reject(error),
    );
}

export async function recoverApplyJournal(
  session: ReviewSession,
  store: SessionStore,
): Promise<boolean> {
  const journalPath = join(
    store.sessionDirectory(session),
    "apply-journal.json",
  );
  const journal = await readFile(journalPath, "utf8")
    .then((value) => JSON.parse(value) as ApplyJournal)
    .catch(() => undefined);
  if (!journal || ["complete", "rolled-back"].includes(journal.state))
    return false;
  for (const entry of [...journal.entries].reverse()) {
    if (entry.started || entry.completed) {
      if (entry.backup) await copyFile(entry.backup, entry.target);
      else await rm(entry.target, { force: true });
    }
    if (entry.temporary) await rm(entry.temporary, { force: true });
  }
  journal.state = "rolled-back";
  await atomicWrite(journalPath, JSON.stringify(journal, null, 2));
  return true;
}

export async function applyFilesystemPlan(
  session: ReviewSession,
  plan: ApplyPlan,
  store: SessionStore,
): Promise<string[]> {
  const directory = store.sessionDirectory(session);
  const journalPath = join(directory, "apply-journal.json");
  await recoverApplyJournal(session, store);
  const entries: JournalEntry[] = [];
  try {
    for (const operation of plan.operations) {
      const target = await assertSafeApplyTarget(
        session.repositoryRoot,
        operation.relativePath,
      );
      const actualHash = await currentHash(target);
      if (actualHash !== operation.expectedHash)
        throw new VsnapError(
          "STALE_BASELINE",
          `Snapshot changed since capture: ${operation.relativePath}`,
          { expected: operation.expectedHash, actual: actualHash },
        );
      const backup =
        actualHash === null
          ? undefined
          : join(
              directory,
              "blobs",
              `backup-${plan.id}-${sha256(operation.relativePath).slice(0, 16)}`,
            );
      if (backup) await copyFile(target, backup);
      const entry: JournalEntry = {
        operation,
        target,
        ...(backup ? { backup } : {}),
        started: false,
        completed: false,
      };
      entries.push(entry);
      if (operation.type !== "delete") {
        await mkdir(dirname(target), { recursive: true });
        const content = await store.readBlob(session, operation.contentBlob);
        if (content === undefined)
          throw new VsnapError(
            "MISSING_BLOB",
            `Missing prepared content for ${operation.relativePath}`,
          );
        entry.temporary = `${target}.${process.pid}.${plan.id}.tmp`;
        await writeFile(entry.temporary, content, {
          mode: operation.type === "update" ? operation.mode : 0o644,
        });
        // Windows requires a writable handle for FlushFileBuffers/fsync.
        const handle = await open(entry.temporary, "r+");
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
      }
    }
  } catch (error) {
    for (const entry of entries)
      if (entry.temporary) await rm(entry.temporary, { force: true });
    throw error;
  }
  let journal: ApplyJournal = {
    schemaVersion: 1,
    planId: plan.id,
    state: "prepared",
    entries,
  };
  await atomicWrite(journalPath, JSON.stringify(journal, null, 2));
  const written: string[] = [];
  try {
    journal = { ...journal, state: "writing" };
    await atomicWrite(journalPath, JSON.stringify(journal, null, 2));
    for (const entry of entries) {
      const { operation, target } = entry;
      entry.started = true;
      await atomicWrite(journalPath, JSON.stringify(journal, null, 2));
      if (operation.type === "delete") await unlink(target);
      else {
        if (!entry.temporary)
          throw new VsnapError(
            "APPLY_NOT_PREPARED",
            `No prepared content exists for ${operation.relativePath}`,
          );
        await rename(entry.temporary, target);
        if (operation.type === "update" && operation.mode !== undefined)
          await chmod(target, operation.mode);
      }
      entry.completed = true;
      written.push(operation.relativePath);
      await atomicWrite(journalPath, JSON.stringify(journal, null, 2));
    }
    journal.state = "complete";
    await atomicWrite(journalPath, JSON.stringify(journal, null, 2));
    return written;
  } catch (error) {
    for (const entry of [...entries].reverse()) {
      if (entry.started || entry.completed) {
        if (entry.backup) await copyFile(entry.backup, entry.target);
        else await rm(entry.target, { force: true });
      } else if (entry.temporary) await rm(entry.temporary, { force: true });
    }
    journal.state = "rolled-back";
    await atomicWrite(journalPath, JSON.stringify(journal, null, 2));
    throw new VsnapError(
      "APPLY_FAILED",
      "Apply failed and repository changes were rolled back",
      error,
    );
  }
}
