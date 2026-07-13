import { assertContainedPath } from "@vsnap/core";
import { VsnapError } from "@vsnap/protocol";
import { readOverlay, writeOverlay } from "@vsnap/session";
import { VitestSnapshotEnvironment } from "vitest/runtime";

function configuration(): { repositoryRoot: string; sessionDirectory: string } {
  const repositoryRoot = process.env.VSNAP_REPOSITORY_ROOT;
  const sessionDirectory = process.env.VSNAP_SESSION_DIRECTORY;
  if (!repositoryRoot || !sessionDirectory)
    throw new VsnapError(
      "OVERLAY_NOT_CONFIGURED",
      "Transactional snapshot environment is missing its session configuration",
    );
  return { repositoryRoot, sessionDirectory };
}

export class TransactionalSnapshotEnvironment extends VitestSnapshotEnvironment {
  private validated(filepath: string): {
    filepath: string;
    sessionDirectory: string;
  } {
    const config = configuration();
    return {
      filepath: assertContainedPath(config.repositoryRoot, filepath),
      sessionDirectory: config.sessionDirectory,
    };
  }
  override async readSnapshotFile(filepath: string): Promise<string | null> {
    const target = this.validated(filepath);
    const candidate = await readOverlay(
      target.sessionDirectory,
      "candidate",
      target.filepath,
    );
    if (candidate !== undefined) return candidate;
    const baseline = await super.readSnapshotFile(target.filepath);
    if (
      (await readOverlay(
        target.sessionDirectory,
        "baseline",
        target.filepath,
      )) === undefined
    )
      await writeOverlay(
        target.sessionDirectory,
        "baseline",
        target.filepath,
        baseline,
      );
    return baseline;
  }
  override async saveSnapshotFile(
    filepath: string,
    snapshot: string,
  ): Promise<void> {
    const target = this.validated(filepath);
    if (
      (await readOverlay(
        target.sessionDirectory,
        "baseline",
        target.filepath,
      )) === undefined
    )
      await writeOverlay(
        target.sessionDirectory,
        "baseline",
        target.filepath,
        await super.readSnapshotFile(target.filepath),
      );
    await writeOverlay(
      target.sessionDirectory,
      "candidate",
      target.filepath,
      snapshot,
    );
  }
  override async removeSnapshotFile(filepath: string): Promise<void> {
    const target = this.validated(filepath);
    if (
      (await readOverlay(
        target.sessionDirectory,
        "baseline",
        target.filepath,
      )) === undefined
    )
      await writeOverlay(
        target.sessionDirectory,
        "baseline",
        target.filepath,
        await super.readSnapshotFile(target.filepath),
      );
    await writeOverlay(
      target.sessionDirectory,
      "candidate",
      target.filepath,
      null,
    );
  }
}

export default new TransactionalSnapshotEnvironment();
