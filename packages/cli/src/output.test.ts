import { VsnapError } from "@vsnap/protocol";
import { describe, expect, it } from "vitest";
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
