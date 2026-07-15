import { describe, expect, it } from "vitest";
import { locateTestSource } from "./source.js";

describe("test source location", () => {
  it("finds a named matcher inside the owning test", () => {
    const content = `describe("account", () => {\n  it("renders profile", () => {\n    expect({ id: 1 }).toMatchSnapshot("profile");\n    expect({ role: "admin" }).toMatchSnapshot("permissions");\n  });\n});\n`;
    const located = locateTestSource(content, "src/account.test.ts", {
      snapshotFile: "src/__snapshots__/account.test.ts.snap",
      snapshotKind: "external",
      snapshotKey: "account > renders profile > permissions 2",
      matcher: "toMatchSnapshot",
      snapshotName: "permissions",
      changeType: "modified",
      ordinal: 2,
      test: { name: "account > renders profile" },
    });
    expect(located).toMatchObject({
      language: "typescript",
      focus: {
        testLine: 2,
        matcherLine: 4,
        matcherLines: [4],
        matcherColumn: 30,
        startLine: 2,
        endLine: 5,
      },
    });
    expect(located.blocks).toEqual([
      {
        kind: "suite",
        content:
          'describe("account", () => {\n  it("renders profile", () => {\n    expect({ id: 1 }).toMatchSnapshot("profile");\n    expect({ role: "admin" }).toMatchSnapshot("permissions");\n  });\n});',
        startLine: 1,
        endLine: 6,
      },
    ]);
  });

  it("shows the full innermost suite while excluding sibling scopes", () => {
    const content = `beforeEach(() => setupRoot());
afterEach(() => cleanupRoot());
describe("sibling", () => {
  beforeEach(() => setupSibling());
});
describe("account", () => {
  beforeEach(() => setupAccount());
  afterEach(() => cleanupAccount());
  it("renders profile", () => {
    expect({ id: 1 }).toMatchSnapshot("profile");
  });
  it("renders another test", () => expect(true).toBe(true));
});
`;
    const located = locateTestSource(content, "src/account.test.ts", {
      snapshotFile: "src/__snapshots__/account.test.ts.snap",
      snapshotKind: "external",
      snapshotKey: "account > renders profile > profile 1",
      matcher: "toMatchSnapshot",
      snapshotName: "profile",
      changeType: "modified",
      test: {
        name: "account > renders profile",
        location: { line: 9, column: 3 },
      },
    });
    expect(located.blocks.map((block) => block.kind)).toEqual([
      "suite",
      "beforeEach",
      "afterEach",
    ]);
    const reviewSource = located.blocks
      .map((block) => block.content)
      .join("\n");
    expect(reviewSource).toContain("setupRoot");
    expect(reviewSource).toContain("setupAccount");
    expect(reviewSource).toContain('it("renders profile"');
    expect(reviewSource).toContain("renders another test");
    expect(reviewSource).not.toContain("setupSibling");
  });

  it("includes imports, nested suites, and suite-level hooks", () => {
    const content = `import { beforeAll, describe, expect, it } from "vitest";
import { createAccount } from "./fixtures";

describe("api", () => {
  beforeAll(() => startApi());
  describe("account", () => {
    beforeEach(() => resetAccount());
    it("renders profile", () => {
      expect(createAccount()).toMatchSnapshot();
    });
    afterAll(() => stopAccount());
  });
});
`;
    const located = locateTestSource(content, "src/account.test.ts", {
      snapshotFile: "src/__snapshots__/account.test.ts.snap",
      snapshotKind: "external",
      snapshotKey: "api > account > renders profile 1",
      matcher: "toMatchSnapshot",
      changeType: "modified",
      test: { name: "api > account > renders profile" },
    });
    expect(located.blocks.map((block) => block.kind)).toEqual([
      "suite",
      "suite",
      "beforeAll",
    ]);
    expect(located.blocks[1]?.content).toContain("resetAccount");
    expect(located.blocks[1]?.content).toContain("stopAccount");
  });

  it("matches a raw file snapshot by its target filename", () => {
    const content = `it("writes status", async () => {\n  await expect(value).toMatchFileSnapshot("./fixtures/status.md");\n});\n`;
    expect(
      locateTestSource(content, "src/status.test.ts", {
        snapshotFile: "src/fixtures/status.md",
        snapshotKind: "file",
        snapshotKey: "<file>",
        matcher: "toMatchFileSnapshot",
        snapshotName: "src/fixtures/status.md",
        changeType: "modified",
        test: { name: "writes status" },
      }).focus,
    ).toMatchObject({ testLine: 1, matcherLine: 2 });
  });

  it("recovers the test when Vitest reports the matcher line", () => {
    const content = `describe("account", () => {
  // The snapshot assertion is intentionally below the declaration.
  it("renders profile", () => {
    expect({ id: 1 }).toMatchSnapshot("profile");
  });
});
`;
    const located = locateTestSource(content, "src/account.test.ts", {
      snapshotFile: "src/__snapshots__/account.test.ts.snap",
      snapshotKind: "external",
      snapshotKey: "account > renders profile > profile 1",
      matcher: "toMatchSnapshot",
      snapshotName: "profile",
      changeType: "modified",
      ordinal: 1,
      test: {
        name: "account > renders profile",
        location: { line: 4, column: 5 },
      },
    });

    expect(located.focus).toMatchObject({
      testLine: 3,
      matcherLine: 4,
      startLine: 3,
      endLine: 5,
    });
    expect(located.blocks).toHaveLength(1);
    expect(located.blocks[0]?.content).toContain('it("renders profile"');
  });

  it("uses the matcher to recover source without test metadata", () => {
    const content = `it("renders profile", () => {
  expect({ id: 1 }).toMatchSnapshot("profile");
});
`;
    const located = locateTestSource(content, "src/account.test.ts", {
      snapshotFile: "src/__snapshots__/account.test.ts.snap",
      snapshotKind: "external",
      snapshotKey: "renders profile > profile 1",
      matcher: "toMatchSnapshot",
      snapshotName: "profile",
      changeType: "modified",
      ordinal: 1,
    });

    expect(located.focus).toMatchObject({
      testLine: 1,
      matcherLine: 2,
      startLine: 1,
      endLine: 3,
    });
    expect(located.blocks[0]?.content).toContain('it("renders profile"');
  });

  it("ignores matcher examples in comments when recovering source", () => {
    const content = `// Example: expect(profile).toMatchSnapshot("profile");
it("renders profile", () => {
  expect({ id: 1 }).toMatchSnapshot("profile");
});
`;
    const located = locateTestSource(content, "src/account.test.ts", {
      snapshotFile: "src/__snapshots__/account.test.ts.snap",
      snapshotKind: "external",
      snapshotKey: "renders profile > profile 1",
      matcher: "toMatchSnapshot",
      snapshotName: "profile",
      changeType: "modified",
      ordinal: 1,
    });

    expect(located.focus).toMatchObject({
      testLine: 2,
      matcherLine: 3,
      startLine: 2,
      endLine: 4,
    });
    expect(located.blocks).toEqual([
      {
        kind: "test",
        content:
          'it("renders profile", () => {\n  expect({ id: 1 }).toMatchSnapshot("profile");\n});',
        startLine: 2,
        endLine: 4,
      },
    ]);
  });

  it("matches a known test title across nested describes", () => {
    const content = `/* eslint-disable no-console */
describe("snapshot in one", () => {
  describe("authentications for authentication", () => {
    it("should have called partners", () => captureSnapshot("wrong"));
  });
  describe("authentications for authorisation", () => {
    it("should have called partners", () => {
      captureSnapshot("target");
    });
  });
});
`;
    const located = locateTestSource(content, "src/account.test.ts", {
      snapshotFile: "src/__snapshots__/account.test.ts.snap",
      snapshotKind: "external",
      snapshotKey:
        "snapshot in one > authentications for authorisation > should have called partners 1",
      matcher: "toMatchSnapshot",
      changeType: "modified",
      ordinal: 1,
      test: {
        name: "snapshot in one > authentications for authorisation > should have called partners",
      },
    });

    expect(located.focus).toMatchObject({
      testLine: 7,
      startLine: 7,
      endLine: 9,
    });
    expect(located.blocks.map((block) => block.kind)).toEqual([
      "suite",
      "suite",
    ]);
    expect(located.blocks[0]?.content).toContain('describe("snapshot in one"');
    expect(located.blocks[1]?.content).toContain(
      'describe("authentications for authorisation"',
    );
    expect(located.blocks[1]?.content).toContain('captureSnapshot("target")');
    expect(
      located.blocks.map((block) => block.content).join("\n"),
    ).not.toContain('captureSnapshot("wrong")');
  });

  it("uses runtime suite locations for describe.each tests registered by a helper", () => {
    const content = `const logsRequest = (title, run) => it(title, run);

describe.each([
  { kind: "authentication" },
  { kind: "authorisation" },
])("authentications for $kind", ({ kind }) => {
  describe("snapshot in one", () => {
    logsRequest("should have called partners", () => {
      expect({ kind }).toMatchSnapshot();
    });
  });
});
`;
    const located = locateTestSource(content, "src/account.test.ts", {
      snapshotFile: "src/__snapshots__/account.test.ts.snap",
      snapshotKind: "external",
      snapshotKey:
        "authentications for authorisation > snapshot in one > should have called partners 1",
      matcher: "toMatchSnapshot",
      changeType: "modified",
      ordinal: 1,
      test: {
        name: "authentications for authorisation > snapshot in one > should have called partners",
        location: { line: 1, column: 37 },
        suites: [
          {
            id: "suite_each",
            name: "authentications for authorisation",
            location: { line: 3, column: 1 },
          },
          {
            id: "suite_nested",
            name: "snapshot in one",
            location: { line: 7, column: 3 },
          },
        ],
      },
    });

    expect(located.focus).toMatchObject({
      testLine: 8,
      matcherLine: 9,
      startLine: 8,
      endLine: 10,
    });
    expect(located.blocks.map((block) => block.kind)).toEqual([
      "suite",
      "suite",
    ]);
    expect(located.blocks[0]?.content).toContain("describe.each");
    expect(located.blocks[0]?.content).toContain('"authentications for $kind"');
    expect(located.blocks[1]?.content).toContain('describe("snapshot in one"');
    expect(located.blocks[1]?.content).toContain(
      'logsRequest("should have called partners"',
    );
    expect(located.blocks[1]?.content).not.toContain("const logsRequest");
  });

  it("uses the runtime callsite when an imported helper owns the test and matcher", () => {
    const content = `import { registerLogRequest } from "./shared-tests";

describe.each([{ kind: "authorisation" }])(
  "authentications for $kind",
  ({ kind }) => {
    describe("snapshot in one", () => {
      registerLogRequest({
        title: "should have called partners",
        run: () => executeRequest(kind),
      });
    });
  },
);
`;
    const located = locateTestSource(content, "src/account.test.ts", {
      snapshotFile: "src/__snapshots__/account.test.ts.snap",
      snapshotKind: "external",
      snapshotKey:
        "authentications for authorisation > snapshot in one > should have called partners 1",
      matcher: "toMatchSnapshot",
      changeType: "modified",
      ordinal: 1,
      test: {
        name: "authentications for authorisation > snapshot in one > should have called partners",
        location: { line: 7, column: 7 },
        suites: [
          {
            id: "suite_each",
            name: "authentications for authorisation",
            location: { line: 3, column: 1 },
          },
          {
            id: "suite_nested",
            name: "snapshot in one",
            location: { line: 6, column: 5 },
          },
        ],
      },
    });

    expect(located.focus).toMatchObject({
      testLine: 7,
      startLine: 7,
      endLine: 10,
    });
    expect(located.focus.matcherLine).toBeUndefined();
    expect(located.blocks.map((block) => block.kind)).toEqual([
      "suite",
      "suite",
    ]);
    expect(located.blocks[0]?.content).toContain("describe.each");
    expect(located.blocks[1]?.content).toContain('describe("snapshot in one"');
    expect(located.blocks[1]?.content).toContain("registerLogRequest({");
    expect(located.blocks[1]?.content).toContain(
      'title: "should have called partners"',
    );
    expect(
      located.blocks.map((block) => block.content).join("\n"),
    ).not.toContain('from "./shared-tests"');
  });
});
