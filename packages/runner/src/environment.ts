import { assertContainedPath } from "@vsnap/core";
import { VsnapError } from "@vsnap/protocol";
import { readOverlay, writeOverlay } from "@vsnap/session";
import { TestRunner } from "vitest";
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
  private readonly provenance = new Map<
    string,
    { testId?: string; testFile?: string }
  >();

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
  override async resolvePath(filepath: string): Promise<string> {
    const target = this.validated(await super.resolvePath(filepath)).filepath;
    this.provenance.set(target, {
      testFile: this.validated(filepath).filepath,
    });
    return target;
  }
  override async resolveRawPath(
    testPath: string,
    rawPath: string,
  ): Promise<string> {
    const target = this.validated(
      await super.resolveRawPath(testPath, rawPath),
    ).filepath;
    const currentTest = TestRunner.getCurrentTest();
    this.provenance.set(target, {
      ...(currentTest?.id ? { testId: currentTest.id } : {}),
      testFile: this.validated(testPath).filepath,
    });
    return target;
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
        this.provenance.get(target.filepath),
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
        this.provenance.get(target.filepath),
      );
    await writeOverlay(
      target.sessionDirectory,
      "candidate",
      target.filepath,
      snapshot,
      this.provenance.get(target.filepath),
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
        this.provenance.get(target.filepath),
      );
    await writeOverlay(
      target.sessionDirectory,
      "candidate",
      target.filepath,
      null,
      this.provenance.get(target.filepath),
    );
  }
}

export default new TransactionalSnapshotEnvironment();
