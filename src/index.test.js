import { describe, expect, it } from "vitest";
import { normalizeSnapshot } from "./index.js";

describe("normalizeSnapshot", () => {
  it("uses LF line endings and a single trailing newline", () => {
    expect(normalizeSnapshot("first\r\nsecond\r\n\r\n")).toBe(
      "first\nsecond\n",
    );
  });

  it("rejects non-string snapshots", () => {
    expect(() => normalizeSnapshot(null)).toThrow(TypeError);
  });
});
