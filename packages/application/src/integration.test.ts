import { cp, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SessionStore } from "@vsnap/session";
import { describe, expect, it } from "vitest";
import { createSnapshotApplication } from "./application.js";

describe("transactional integration", () => {
  it("captures without repository writes and applies only after approval", async () => {
    const fixtureSource = resolve("../../tests/fixtures/basic-vitest");
    const fixtureParent = await mkdtemp(join(tmpdir(), "vsnap-fixture-"));
    const fixture = join(fixtureParent, "project");
    await cp(fixtureSource, fixture, {
      recursive: true,
      filter: (source) => !source.includes("node_modules"),
    });
    await symlink(
      resolve("../../node_modules"),
      join(fixture, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const snapshot = join(fixture, "src/__snapshots__/value.test.ts.snap");
    const before = await readFile(snapshot, "utf8");
    const store = new SessionStore({
      cacheRoot: await mkdtemp(join(tmpdir(), "vsnap-integration-")),
    });
    const app = createSnapshotApplication({
      store,
      environmentPath: resolve("../runner/dist/environment.js"),
    });
    const session = await app.startRun({ repositoryRoot: fixture });
    expect(session.state).toBe("completed");
    expect(session.summary.snapshotChanges).toBe(1);
    expect(await readFile(snapshot, "utf8")).toBe(before);
    const entries = await app.listNodes({
      sessionId: session.id,
      kind: "entry",
    });
    expect(entries.items).toHaveLength(1);
    const entry = entries.items[0];
    if (!entry) throw new Error("Expected one snapshot entry");
    const diff = await app.getDiff({
      sessionId: session.id,
      entryId: entry.id,
    });
    expect(diff.context).toMatchObject({
      matcher: "toMatchSnapshot",
      ordinal: 1,
      snapshotFile: "src/__snapshots__/value.test.ts.snap",
      test: {
        name: "captures a value",
        file: "src/value.test.ts",
        status: "passed",
      },
    });
    await app.setDecision({
      sessionId: session.id,
      selector: entry.id,
      decision: "accepted",
    });
    const plan = await app.createPreview({ sessionId: session.id });
    expect(plan.patch).toContain("candidate");
    expect(await readFile(snapshot, "utf8")).toBe(before);
    const applied = await app.apply({ sessionId: session.id });
    expect(applied.code).toBe("APPLIED");
    expect(await readFile(snapshot, "utf8")).toContain("candidate");
    const verified = await app.verify({ sessionId: session.id });
    expect(verified.summary.snapshotChanges).toBe(0);

    const inlineTest = join(fixture, "src/inline.test.ts");
    await writeFile(
      inlineTest,
      `import { expect, it } from "vitest";\nit("captures inline evidence", () => {\n  expect({ answer: 42 }).toMatchInlineSnapshot();\n});\n`,
    );
    const inlineBefore = await readFile(inlineTest, "utf8");
    const inlineSession = await app.startRun({
      repositoryRoot: fixture,
      vitestArgs: ["src/inline.test.ts"],
    });
    expect(await readFile(inlineTest, "utf8")).toBe(inlineBefore);
    const inlineIndex = await store.readIndex(inlineSession);
    expect(inlineIndex.files[0]?.kind).toBe("inline-unsupported");
    await expect(
      app.setDecision({
        sessionId: inlineSession.id,
        selector: inlineIndex.entries[0]?.id ?? "entry_missing",
        decision: "accepted",
      }),
    ).rejects.toMatchObject({ code: "INLINE_SNAPSHOT_UNSUPPORTED" });
    expect(
      (await app.createPreview({ sessionId: inlineSession.id })).operations,
    ).toHaveLength(0);
  }, 30_000);
});
