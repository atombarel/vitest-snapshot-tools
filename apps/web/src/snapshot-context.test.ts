import { describe, expect, it } from "vitest";
import { matcherInvocation, snapshotTitle } from "./snapshot-context.js";

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

describe("snapshotTitle", () => {
  const context = {
    snapshotFile: "value.snap",
    snapshotKind: "external" as const,
    snapshotKey: "key 1",
    matcher: "toMatchSnapshot" as const,
    changeType: "modified" as const,
  };

  it("uses the leaf test name for an unnamed nested snapshot", () => {
    expect(
      snapshotTitle(
        {
          ...context,
          test: {
            name: "Promo > collecte MdC > source 'web' > déclenchement promo > déclenchement de la promo > should have correct response",
          },
        },
        1,
      ),
    ).toBe("should have correct response");
  });

  it("keeps explicit snapshot names and falls back when test context is absent", () => {
    expect(snapshotTitle({ ...context, snapshotName: "response" }, 1)).toBe(
      "response",
    );
    expect(snapshotTitle(context, 2)).toBe("Snapshot 2");
  });
});
