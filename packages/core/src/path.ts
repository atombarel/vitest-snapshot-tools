import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { VsnapError } from "@vsnap/protocol";

export function assertContainedPath(
  repositoryRoot: string,
  target: string,
): string {
  const absolute = isAbsolute(target)
    ? resolve(target)
    : resolve(repositoryRoot, target);
  const rel = relative(resolve(repositoryRoot), absolute);
  if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel))
    throw new VsnapError(
      "UNSAFE_PATH",
      `Snapshot path is outside the repository: ${target}`,
    );
  return absolute;
}

export async function assertSafeApplyTarget(
  repositoryRoot: string,
  target: string,
): Promise<string> {
  const absolute = assertContainedPath(repositoryRoot, target);
  const relativeTarget = relative(resolve(repositoryRoot), absolute);
  let current = resolve(repositoryRoot);
  for (const segment of relativeTarget.split(sep)) {
    current = join(current, segment);
    const stats = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!stats) break;
    if (stats.isSymbolicLink())
      throw new VsnapError(
        "SYMLINK_TARGET",
        `Refusing symlinked snapshot path: ${target}`,
      );
  }
  let existingParent = dirname(absolute);
  while (!(await lstat(existingParent).catch(() => undefined)))
    existingParent = dirname(existingParent);
  assertContainedPath(repositoryRoot, await realpath(existingParent));
  return absolute;
}
