import { describe, expect, it } from "vitest";
import {
  applyAcceptedHunks,
  createEntryDiff,
  deriveDecision,
  indexSnapshot,
  parseSnapshotFile,
  serializeSnapshotEntry,
  summarizeHunk,
  synthesizeSnapshotFile,
} from "./index.js";

describe("safe snapshot parsing", () => {
  it("decodes static templates and groups ordinals without executing source", () => {
    const source =
      "// Snapshot v1\n\nexports[`suite value 1`] = `line\\n\\`tick\\` \\${literal} \\\\`;\nexports[`suite value 2`] = ``;\n";
    const parsed = parseSnapshotFile(source);
    expect(parsed.parseMode).toBe("entries");
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries[0]).toMatchObject({
      key: "suite value 1",
      testName: "suite value",
      ordinal: 1,
      value: "line\n`tick` ${literal} \\",
    });
    expect(parsed.entries[1]?.value).toBe("");
  });
  it.each([
    "exports[`x 1`] = dangerous();",
    "exports[`x 1`] = `${dangerous()}`;",
    "globalThis.pwned = true;",
    "exports[key] = `x`;",
  ])("falls back to opaque for executable input: %s", (source) =>
    expect(parseSnapshotFile(source).parseMode).toBe("opaque"));
  it("round trips every significant escape", () => {
    const value = "` \\ ${ raw }\r\n雪";
    const source = `${serializeSnapshotEntry("escape 1", value)}\n`;
    expect(parseSnapshotFile(source).entries[0]?.value).toBe(value);
  });
});

describe("diff and synthesis", () => {
  it("summarizes exact changed lines without diff context", () => {
    expect(
      summarizeHunk([
        "  {",
        '-   "status": "pending",',
        '+   "status": "active",',
        "  }",
      ]),
    ).toBe('"status": "pending", → "status": "active",');
    expect(summarizeHunk(["+ added"])).toBe("Added added");
  });

  it("uses stable hunks and applies accepted hunks only", () => {
    const first = createEntryDiff(
      "entry_123",
      "one\ntwo\nthree\n",
      "one\nTWO\nthree\n",
    );
    const second = createEntryDiff(
      "entry_123",
      "one\ntwo\nthree\n",
      "one\nTWO\nthree\n",
    );
    expect(first.hunks[0]?.id).toBe(second.hunks[0]?.id);
    expect(applyAcceptedHunks(first)).toBe("one\ntwo\nthree\n");
    expect(
      applyAcceptedHunks({
        ...first,
        hunks: first.hunks.map((hunk) => ({ ...hunk, decision: "accepted" })),
      }),
    ).toBe("one\nTWO\nthree\n");
  });
  it("groups identical changed lines even when unchanged context differs", () => {
    const first = createEntryDiff(
      "entry_first",
      '{\n  "id": 1,\n  "name": "Ada"\n}\n',
      '{\n  "id": 1,\n  "apiVersion": 2,\n  "name": "Ada"\n}\n',
    );
    const second = createEntryDiff(
      "entry_second",
      '{\n  "id": 99,\n  "name": "Grace"\n}\n',
      '{\n  "id": 99,\n  "apiVersion": 2,\n  "name": "Grace"\n}\n',
    );
    expect(first.hunks[0]?.contentHash).not.toBe(second.hunks[0]?.contentHash);
    expect(first.hunks[0]?.changeHash).toBe(second.hunks[0]?.changeHash);
  });
  it("derives mixed and pending parent states", () => {
    expect(
      deriveDecision([
        { decision: "accepted" },
        { decision: "rejected" },
      ] as never),
    ).toBe("mixed");
    expect(
      deriveDecision([
        { decision: "accepted" },
        { decision: "pending" },
      ] as never),
    ).toBe("pending");
  });
  it("indexes added, modified, deleted and obsolete entries", () => {
    const before =
      "exports[`same 1`] = `a`;\nexports[`gone 1`] = `old`;\nexports[`changed 1`] = `old`;\n";
    const after =
      "exports[`same 1`] = `a`;\nexports[`changed 1`] = `new`;\nexports[`added 1`] = `new`;\n";
    const indexed = indexSnapshot("x.snap", before, after);
    expect(
      indexed.entries.map((entry) => [entry.key, entry.changeType]),
    ).toEqual([
      ["added 1", "added"],
      ["changed 1", "modified"],
      ["gone 1", "deleted"],
    ]);
  });
  it("minimally rewrites standard files", () => {
    const before =
      "// Snapshot v1\n\nexports[`a 1`] = `old`;\n\nexports[`b 1`] = `keep`;\n";
    const result = synthesizeSnapshotFile(
      before,
      new Map([
        ["a 1", "new"],
        ["c 1", "added"],
      ]),
    );
    expect(result).toContain("exports[`a 1`] = `new`");
    expect(result).toContain("exports[`b 1`] = `keep`");
    expect(result).toContain("exports[`c 1`] = `added`");
  });
  it("preserves CRLF while rewriting and appending entries", () => {
    const before = "// Snapshot v1\r\n\r\nexports[`a 1`] = `old\r\nvalue`;\r\n";
    const result = synthesizeSnapshotFile(
      before,
      new Map([
        ["a 1", "new\nvalue"],
        ["b 1", "added\nvalue"],
      ]),
    );
    expect(result?.replaceAll("\r\n", "")).not.toContain("\n");
  });
});
