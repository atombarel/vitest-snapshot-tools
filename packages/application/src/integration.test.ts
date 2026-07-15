import { cp, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SessionStore } from "@vsnap/session";
import { describe, expect, it } from "vitest";
import { createSnapshotApplication } from "./application.js";

describe("transactional integration", () => {
  it("tails run events from an advancing byte offset", async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "vsnap-events-repo-"));
    const store = new SessionStore({
      cacheRoot: await mkdtemp(join(tmpdir(), "vsnap-events-cache-")),
    });
    const offsets: number[] = [];
    const readEventChunk = store.readEventChunk.bind(store);
    store.readEventChunk = async (session, offset = 0) => {
      offsets.push(offset);
      return readEventChunk(session, offset);
    };
    const session = await store.create(repositoryRoot);
    await store.appendEvent(session, {
      schemaVersion: 1,
      sequence: 1,
      sessionId: session.id,
      type: "run.started",
      timestamp: "2026-01-01T00:00:00.000Z",
      payload: {},
    });
    await store.appendEvent(session, {
      schemaVersion: 1,
      sequence: 2,
      sessionId: session.id,
      type: "run.finished",
      timestamp: "2026-01-01T00:00:01.000Z",
      payload: {},
    });
    await store.save({
      ...session,
      state: "completed",
      completedAt: "2026-01-01T00:00:01.000Z",
    });
    const app = createSnapshotApplication({ store });
    const events = [];
    for await (const event of app.subscribe(session.id)) events.push(event);
    const progress = [];
    for await (const update of app.subscribeProgress(session.id))
      progress.push(update);

    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(progress.at(-1)).toMatchObject({ sequence: 2, runEnded: true });
    expect(offsets[0]).toBe(0);
    expect(offsets.at(-1)).toBeGreaterThan(0);
  });

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
    expect(session.summary.snapshotChanges).toBe(2);
    expect(await readFile(snapshot, "utf8")).toBe(before);
    const entries = await app.listNodes({
      sessionId: session.id,
      kind: "entry",
    });
    expect(entries.items).toHaveLength(2);
    const entry = entries.items[0];
    if (!entry) throw new Error("Expected one snapshot entry");
    const tests = await app.listNodes({
      sessionId: session.id,
      kind: "test",
    });
    expect(tests.items).toHaveLength(1);
    expect(tests.items[0]).toMatchObject({
      label: "captures a value",
      childCount: 2,
      entryId: entry.id,
    });
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
        location: { line: 3 },
      },
    });
    const source = await app.getTestSource({
      sessionId: session.id,
      entryId: entry.id,
    });
    expect(source).toMatchObject({
      relativePath: "src/value.test.ts",
      language: "typescript",
      focus: { testLine: 3 },
    });
    expect(source.content).toContain("toMatchSnapshot");
    expect(source.content).not.toContain("import { expect, it }");
    expect(source.content.trim()).toMatch(/^it\("captures a value"/);
    expect(source.blocks.map((block) => block.kind)).toEqual(["test"]);
    const review = await app.getTestReview({
      sessionId: session.id,
      entryId: entry.id,
    });
    expect(review.entries).toHaveLength(2);
    expect(review.source.focus.matcherLines).toHaveLength(2);
    const familyIndex = await store.readIndex(session);
    const firstFamilyHunk = familyIndex.hunks[0];
    const secondFamilyHunk = familyIndex.hunks[1];
    if (!firstFamilyHunk || !secondFamilyHunk)
      throw new Error("Expected two indexed hunks");
    secondFamilyHunk.changeHash =
      firstFamilyHunk.changeHash ?? firstFamilyHunk.contentHash;
    if (firstFamilyHunk.summary !== undefined)
      secondFamilyHunk.summary = firstFamilyHunk.summary;
    familyIndex.hunks.push(
      {
        ...firstFamilyHunk,
        id: "hunk_first-entry-second-change",
        oldStart: firstFamilyHunk.oldStart + 100,
        newStart: firstFamilyHunk.newStart + 100,
        contentHash: "first-entry-second-content",
        changeHash: "shared-second-change",
        summary: "Second related change",
      },
      {
        ...secondFamilyHunk,
        id: "hunk_second-entry-second-change",
        oldStart: secondFamilyHunk.oldStart + 100,
        newStart: secondFamilyHunk.newStart + 100,
        contentHash: "second-entry-second-content",
        changeHash: "different-second-change",
        summary: "Second related change",
      },
    );
    await store.writeIndex(session, familyIndex);
    const splitFamilies = await app.listNodes({
      sessionId: session.id,
      kind: "family",
    });
    expect(splitFamilies.items).toHaveLength(2);
    const secondRelatedHunk = familyIndex.hunks.at(-1);
    if (!secondRelatedHunk) throw new Error("Expected a second related hunk");
    secondRelatedHunk.changeHash = "shared-second-change";
    await store.writeIndex(session, familyIndex);
    const families = await app.listNodes({
      sessionId: session.id,
      kind: "family",
    });
    expect(families.items).toHaveLength(1);
    expect(families.items[0]).toMatchObject({
      kind: "family",
      confidence: "exact",
      childCount: 2,
      testCount: 1,
      fileCount: 1,
      label: expect.stringMatching(
        /metadata \+ record in captures a value · 2 related changes/,
      ),
    });
    const family = families.items[0];
    if (!family) throw new Error("Expected one exact change family");
    const familyDecision = await app.setDecision({
      sessionId: session.id,
      selector: family.id,
      decision: "accepted",
    });
    expect(familyDecision.affectedHunks).toHaveLength(4);
    const unsafeIndex = await store.readIndex(session);
    const sourceFile = unsafeIndex.files[0];
    if (!sourceFile) throw new Error("Expected indexed snapshot file");
    sourceFile.testFile = "../../outside.test.ts";
    await store.writeIndex(session, unsafeIndex);
    await expect(
      app.getTestSource({ sessionId: session.id, entryId: entry.id }),
    ).rejects.toMatchObject({ code: "UNSAFE_PATH" });
    sourceFile.testFile = "src/value.test.ts";
    await store.writeIndex(session, unsafeIndex);
    for (const reviewEntry of review.entries)
      await app.setDecision({
        sessionId: session.id,
        selector: reviewEntry.entryId,
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

  it("locates helper-generated tests inside nested describe.each suites", async () => {
    const fixtureSource = resolve("../../tests/fixtures/complex-vitest");
    const fixtureParent = await mkdtemp(join(tmpdir(), "vsnap-complex-repo-"));
    const fixture = join(fixtureParent, "project");
    await cp(fixtureSource, fixture, { recursive: true });
    await symlink(
      resolve("../../node_modules"),
      join(fixture, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const store = new SessionStore({
      cacheRoot: await mkdtemp(join(tmpdir(), "vsnap-complex-cache-")),
    });
    const app = createSnapshotApplication({
      store,
      environmentPath: resolve("../runner/dist/environment.js"),
    });

    const session = await app.startRun({ repositoryRoot: fixture });
    const index = await store.readIndex(session);
    const entry = index.entries.find((candidate) =>
      candidate.key.includes("authorisation"),
    );
    if (!entry) throw new Error("Expected the authorisation snapshot entry");
    const diff = await app.getDiff({
      sessionId: session.id,
      entryId: entry.id,
    });
    expect(diff.context.test).toMatchObject({
      name: "authentications for 'authorisation' > snapshot in one > should have called partners",
      suites: [
        { name: "authentications for 'authorisation'" },
        { name: "snapshot in one" },
      ],
    });

    const source = await app.getTestSource({
      sessionId: session.id,
      entryId: entry.id,
    });
    expect(source.blocks.map((block) => block.kind)).toEqual([
      "suite",
      "suite",
      "test",
    ]);
    expect(source.blocks[0]?.content).toContain("describe.each");
    expect(source.blocks[1]?.content).toContain('describe("snapshot in one"');
    expect(source.blocks[2]?.content).toContain(
      'logsRequest("should have called partners"',
    );
    expect(
      source.blocks.map((block) => block.content).join("\n"),
    ).not.toContain("const logsRequest");
  }, 30_000);
});
