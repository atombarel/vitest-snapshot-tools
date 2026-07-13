import { mkdir, mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertSafeApplyTarget } from "./path.js";

describe("apply target safety", () => {
  it("allows new nested targets and rejects symlinked paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "vsnap-path-"));
    await expect(
      assertSafeApplyTarget(root, "new/deep/value.snap"),
    ).resolves.toBe(join(root, "new/deep/value.snap"));
    const outside = await mkdtemp(join(tmpdir(), "vsnap-outside-"));
    await mkdir(join(root, "snapshots"));
    await symlink(
      outside,
      join(root, "snapshots/link"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(
      assertSafeApplyTarget(root, "snapshots/link/value.snap"),
    ).rejects.toMatchObject({ code: "SYMLINK_TARGET" });
  });
});
