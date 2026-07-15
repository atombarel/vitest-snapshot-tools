import { describe, expect, it } from "vitest";
import {
  createEmptyRunProgress,
  formatElapsed,
  progressPhase,
} from "./run-progress.js";

const sessionId = "4d743cfe-85f1-419a-b437-799ca6ce7476";

describe("run progress", () => {
  it("distinguishes test execution from post-test snapshot preparation", () => {
    const progress = createEmptyRunProgress(sessionId);
    expect(progressPhase(progress, "running")).toBe("Collecting tests");
    progress.testsDiscovered = 5;
    progress.testsFinished = 2;
    expect(progressPhase(progress, "running")).toBe("Running tests");
    progress.testsFinished = 5;
    expect(progressPhase(progress, "running")).toBe(
      "Preparing snapshot review",
    );
  });

  it("formats short and minute-scale elapsed times", () => {
    expect(formatElapsed(9_900)).toBe("9s");
    expect(formatElapsed(69_000)).toBe("1m 09s");
  });
});
