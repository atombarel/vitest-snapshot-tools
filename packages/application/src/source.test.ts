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
        content: 'describe("account", () => {',
        startLine: 1,
        endLine: 1,
      },
      {
        kind: "test",
        content:
          '  it("renders profile", () => {\n    expect({ id: 1 }).toMatchSnapshot("profile");\n    expect({ role: "admin" }).toMatchSnapshot("permissions");\n  });',
        startLine: 2,
        endLine: 5,
      },
    ]);
  });

  it("includes parent hooks but excludes hooks and tests from sibling scopes", () => {
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
      "beforeEach",
      "test",
      "afterEach",
      "afterEach",
    ]);
    const reviewSource = located.blocks
      .map((block) => block.content)
      .join("\n");
    expect(reviewSource).toContain("setupRoot");
    expect(reviewSource).toContain("setupAccount");
    expect(reviewSource).toContain('it("renders profile"');
    expect(reviewSource).not.toContain("setupSibling");
    expect(reviewSource).not.toContain("renders another test");
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
      "imports",
      "suite",
      "suite",
      "beforeAll",
      "beforeEach",
      "test",
      "afterAll",
    ]);
    expect(located.blocks.map((block) => block.content).join("\n")).toContain(
      'import { createAccount } from "./fixtures"',
    );
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
});
