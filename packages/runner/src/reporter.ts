import type { RunEvent } from "@vsnap/protocol";
import type { Reporter, TestCase, TestModule, TestSuite } from "vitest/node";

export type EventSink = (
  type: RunEvent["type"],
  payload: Record<string, unknown>,
) => void | Promise<void>;

function modulePayload(module: TestModule): Record<string, unknown> {
  return {
    id: module.id,
    file: module.relativeModuleId,
    state: module.state(),
  };
}

export class SnapshotReporter implements Reporter {
  constructor(
    private readonly emit: EventSink,
    private readonly onModuleComplete?: () => void | Promise<void>,
  ) {}
  async onTestRunStart(): Promise<void> {
    await this.emit("run.started", {});
  }
  async onTestModuleQueued(module: TestModule): Promise<void> {
    await this.emit("module.queued", modulePayload(module));
  }
  async onTestModuleCollected(module: TestModule): Promise<void> {
    await this.emit("module.collected", {
      ...modulePayload(module),
      tests: [...module.children.allTests()].length,
    });
  }
  async onTestModuleStart(module: TestModule): Promise<void> {
    await this.emit("module.started", modulePayload(module));
  }
  async onTestCaseReady(test: TestCase): Promise<void> {
    await this.emit("test.started", {
      id: test.id,
      moduleId: test.module.id,
      file: test.module.relativeModuleId,
      name: test.fullName,
      location: test.location,
    });
  }
  async onTestCaseResult(test: TestCase): Promise<void> {
    const result = test.result();
    const diagnostic = test.diagnostic();
    await this.emit("test.finished", {
      id: test.id,
      moduleId: test.module.id,
      file: test.module.relativeModuleId,
      name: test.fullName,
      location: test.location,
      status: result.state,
      durationMs: diagnostic?.duration ?? 0,
      failures: result.errors ?? [],
    });
  }
  async onTestSuiteReady(suite: TestSuite): Promise<void> {
    await this.emit("suite.started", {
      id: suite.id,
      moduleId: suite.module.id,
      name: suite.name,
      parentId: suite.parent.id,
    });
  }
  async onTestSuiteResult(suite: TestSuite): Promise<void> {
    await this.emit("suite.finished", {
      id: suite.id,
      moduleId: suite.module.id,
      name: suite.name,
      parentId: suite.parent.id,
      state: suite.state(),
      errors: suite.errors(),
    });
  }
  // Intentionally omit onUserConsoleLog. The review UI does not consume
  // console records, and persisting high-volume application logs can dwarf
  // the test lifecycle events that drive progress.
  async onTestModuleEnd(module: TestModule): Promise<void> {
    await this.emit("module.finished", {
      ...modulePayload(module),
      durationMs: module.diagnostic().duration,
      errors: module.errors(),
    });
  }
  async onTestRunEnd(
    modules: ReadonlyArray<TestModule>,
    errors: ReadonlyArray<unknown>,
    reason: "passed" | "interrupted" | "failed",
  ): Promise<void> {
    // Snapshot overlays are complete at this point. Rebuilding after every
    // module repeatedly re-indexes all previously discovered snapshots and
    // makes larger suites quadratic in the number of modules.
    await this.onModuleComplete?.();
    await this.emit(
      reason === "interrupted"
        ? "run.interrupted"
        : reason === "failed"
          ? "run.failed"
          : "run.finished",
      { reason, modules: modules.length, errors },
    );
  }
}
