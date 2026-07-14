import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "@vsnap/session";
import { describe, expect, it } from "vitest";
import { recoverApplyJournal } from "./apply.js";

describe("apply journal recovery", () => {
  it("restores a target whose mutation started before a crash", async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "vsnap-recover-repo-"));
    const store = new SessionStore({
      cacheRoot: await mkdtemp(join(tmpdir(), "vsnap-recover-cache-")),
    });
    const session = await store.create(repositoryRoot);
    const target = join(repositoryRoot, "value.snap");
    const backup = join(store.sessionDirectory(session), "blobs", "backup");
    await writeFile(target, "mutated");
    await writeFile(backup, "baseline");
    await writeFile(
      join(store.sessionDirectory(session), "apply-journal.json"),
      JSON.stringify({
        schemaVersion: 1,
        planId: "plan_crashed",
        state: "writing",
        entries: [
          {
            operation: {
              type: "update",
              relativePath: "value.snap",
              expectedHash: "0".repeat(64),
              contentBlob: "candidate",
            },
            target,
            backup,
            started: true,
            completed: false,
          },
        ],
      }),
    );
    await expect(recoverApplyJournal(session, store)).resolves.toBe(true);
    expect(await readFile(target, "utf8")).toBe("baseline");
  });
});
