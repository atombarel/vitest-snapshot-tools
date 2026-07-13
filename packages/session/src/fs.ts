import { mkdir, open, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function secureMkdir(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
}

export async function atomicWrite(
  path: string,
  content: string | Uint8Array,
  mode = 0o600,
): Promise<void> {
  await secureMkdir(dirname(path));
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, content, { mode });
  // Windows requires a writable handle for FlushFileBuffers, which backs fsync.
  const handle = await open(temporary, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
  try {
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch {
    /* Directory fsync is not available on every platform. */
  }
}
