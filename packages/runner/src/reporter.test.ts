import { describe, expect, it, vi } from "vitest";
import { SnapshotReporter } from "./reporter.js";

describe("SnapshotReporter", () => {
  it("does not persist console output that is unused by run progress", () => {
    const reporter = new SnapshotReporter(vi.fn());

    expect(reporter).not.toHaveProperty("onUserConsoleLog");
  });

  it("persists the runtime suite path with generated tests", async () => {
    const emit = vi.fn();
    const reporter = new SnapshotReporter(emit);
    const module = {
      type: "module",
      id: "module",
      relativeModuleId: "src/value.test.ts",
    };
    const outer = {
      type: "suite",
      id: "outer",
      name: "accounts for authorisation",
      location: { line: 3, column: 1 },
      parent: module,
    };
    const inner = {
      type: "suite",
      id: "inner",
      name: "snapshot in one",
      location: { line: 7, column: 3 },
      parent: outer,
    };
    const test = {
      id: "test",
      module,
      parent: inner,
      fullName: "accounts for authorisation > snapshot in one > captures logs",
      location: { line: 1, column: 37 },
      result: () => ({ state: "passed" }),
      diagnostic: () => ({ duration: 1 }),
    };

    await reporter.onTestCaseResult(test as never);

    expect(emit).toHaveBeenCalledWith(
      "test.finished",
      expect.objectContaining({
        suites: [
          expect.objectContaining({
            id: "outer",
            location: expect.objectContaining({ line: 3 }),
          }),
          expect.objectContaining({
            id: "inner",
            location: expect.objectContaining({ line: 7 }),
          }),
        ],
      }),
    );
  });
});
