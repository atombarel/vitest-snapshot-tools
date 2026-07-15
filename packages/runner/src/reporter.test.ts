import { describe, expect, it, vi } from "vitest";
import { SnapshotReporter } from "./reporter.js";

describe("SnapshotReporter", () => {
  it("does not persist console output that is unused by run progress", () => {
    const reporter = new SnapshotReporter(vi.fn());

    expect(reporter).not.toHaveProperty("onUserConsoleLog");
  });
});
