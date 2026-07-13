import { realpath } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { sha256 } from "@vsnap/core";

export function platformCacheRoot(
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (env.XDG_CACHE_HOME)
    return join(env.XDG_CACHE_HOME, "vitest-snapshot-tools");
  if (platform() === "win32")
    return join(
      env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
      "vitest-snapshot-tools",
      "Cache",
    );
  if (platform() === "darwin")
    return join(homedir(), "Library", "Caches", "vitest-snapshot-tools");
  return join(homedir(), ".cache", "vitest-snapshot-tools");
}

export async function canonicalRepository(
  root: string,
): Promise<{ root: string; hash: string }> {
  const canonical = await realpath(root);
  return {
    root: canonical,
    hash: sha256(platform() === "win32" ? canonical.toLowerCase() : canonical),
  };
}

export function repositoryDirectory(
  cacheRoot: string,
  repositoryHash: string,
): string {
  return join(cacheRoot, "repositories", repositoryHash);
}
