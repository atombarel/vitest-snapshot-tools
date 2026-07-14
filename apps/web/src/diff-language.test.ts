import { describe, expect, it } from "vitest";
import { inferSnapshotLanguage } from "./diff-language.js";

describe("inferSnapshotLanguage", () => {
  it("highlights JSON only when every populated side parses safely", () => {
    expect(
      inferSnapshotLanguage('{"status":"draft"}', '{"status":"ready"}'),
    ).toBe("json");
    expect(inferSnapshotLanguage("", '[{"created":true}]')).toBe("json");
    expect(inferSnapshotLanguage('{"valid":true}', "not json")).toBeUndefined();
  });

  it("skips syntax work for oversized snapshots", () => {
    const oversized = `"${"x".repeat(250_001)}"`;
    expect(inferSnapshotLanguage(oversized, oversized)).toBeUndefined();
  });
});
