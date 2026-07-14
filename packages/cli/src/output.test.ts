import { VsnapError } from "@vsnap/protocol";
import { describe, expect, it } from "vitest";
import { formatFamilyNode } from "./index.js";
import { envelope, errorEnvelope, exitCode } from "./output.js";

describe("CLI envelopes", () => {
  it("uses one versioned success envelope", () =>
    expect(envelope("status", { state: "completed" })).toEqual({
      schemaVersion: 1,
      ok: true,
      command: "status",
      data: { state: "completed" },
    }));
  it("maps conflict and unsupported errors", () => {
    expect(exitCode(new VsnapError("STALE_REVISION", "stale"))).toBe(3);
    expect(
      exitCode(new VsnapError("UNSUPPORTED_BROWSER_MODE", "browser")),
    ).toBe(4);
    expect(
      errorEnvelope("apply", new VsnapError("STALE_BASELINE", "changed")),
    ).toMatchObject({ ok: false, error: { code: "STALE_BASELINE" } });
  });
});

describe("family output", () => {
  it("shows the review compression and affected scope", () =>
    expect(
      formatFamilyNode({
        id: "family_api-version",
        kind: "family",
        entryId: "entry_customer-1",
        label: "API version added",
        decision: "pending",
        childCount: 40,
        testCount: 40,
        fileCount: 1,
        confidence: "exact",
      }),
    ).toBe(
      "family_api-version  pending  40 occurrences · 40 tests · 1 file · API version added",
    ));
});
