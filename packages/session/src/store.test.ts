import { mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionStore } from "./store.js";

describe("SessionStore", () => {
  it("persists validated sessions and content-addressed blobs privately", async () => {
    const root = await mkdtemp(join(tmpdir(), "vsnap-repo-"));
    const cacheRoot = await mkdtemp(join(tmpdir(), "vsnap-cache-"));
    const store = new SessionStore({
      cacheRoot,
      uuid: () => "00000000-0000-4000-8000-000000000001",
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });
    const session = await store.create(root, ["--run"]);
    expect((await store.load(session.id)).repositoryRoot).toBe(
      await realpath(root),
    );
    const hash = await store.writeBlob(session, "secret");
    expect(await store.readBlob(session, hash)).toBe("secret");
    if (process.platform !== "win32") {
      expect(
        (await stat(join(store.sessionDirectory(session), "session.json")))
          .mode & 0o777,
      ).toBe(0o600);
    }
  });
  it("quarantines corrupt sessions in place", async () => {
    const root = await mkdtemp(join(tmpdir(), "vsnap-repo-"));
    const cacheRoot = await mkdtemp(join(tmpdir(), "vsnap-cache-"));
    const store = new SessionStore({ cacheRoot });
    const session = await store.create(root);
    await writeFile(
      join(store.sessionDirectory(session), "session.json"),
      "not json",
    );
    await expect(store.load(session.id)).rejects.toMatchObject({
      code: "CORRUPT_SESSION",
    });
    expect(
      await readFile(
        join(store.sessionDirectory(session), "session.json"),
        "utf8",
      ),
    ).toBe("not json");
  });
  it("rejects concurrent ownership and releases the lock", async () => {
    const root = await mkdtemp(join(tmpdir(), "vsnap-repo-"));
    const store = new SessionStore({
      cacheRoot: await mkdtemp(join(tmpdir(), "vsnap-cache-")),
    });
    const session = await store.create(root);
    await store.withSessionLock(session, async () => {
      await expect(
        store.withSessionLock(session, async () => undefined),
      ).rejects.toMatchObject({ code: "SESSION_BUSY" });
    });
    await expect(
      store.withSessionLock(session, async () => "released"),
    ).resolves.toBe("released");
  });
});
