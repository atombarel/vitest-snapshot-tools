import { describe, expect, it } from "vitest";
import { matcherInvocation } from "./snapshot-context.js";

describe("matcherInvocation", () => {
  it("identifies named and ordinal snapshot assertions", () => {
    expect(
      matcherInvocation({
        snapshotFile: "value.snap",
        snapshotKind: "external",
        snapshotKey: "suite > profile 1",
        matcher: "toMatchSnapshot",
        snapshotName: "profile",
        changeType: "modified",
        ordinal: 1,
      }),
    ).toBe('toMatchSnapshot("profile")');
    expect(
      matcherInvocation({
        snapshotFile: "value.snap",
        snapshotKind: "external",
        snapshotKey: "suite 2",
        matcher: "toMatchSnapshot",
        changeType: "modified",
        ordinal: 2,
      }),
    ).toBe("toMatchSnapshot #2");
  });
});
