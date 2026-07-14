import { describe, expect, it } from "vitest";
import { locateTestSource } from "./source.js";

describe("test source location", () => {
  it("finds a named matcher inside the owning test", () => {
    const content = `describe("account", () => {\n  it("renders profile", () => {\n    expect({ id: 1 }).toMatchSnapshot("profile");\n    expect({ role: "admin" }).toMatchSnapshot("permissions");\n  });\n});\n`;
    expect(
      locateTestSource(content, "src/account.test.ts", {
        snapshotFile: "src/__snapshots__/account.test.ts.snap",
        snapshotKind: "external",
        snapshotKey: "account > renders profile > permissions 2",
        matcher: "toMatchSnapshot",
        snapshotName: "permissions",
        changeType: "modified",
        ordinal: 2,
        test: { name: "account > renders profile" },
      }),
    ).toEqual({
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
