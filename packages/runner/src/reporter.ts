import type { RunEvent } from "@vsnap/protocol";
import type { Reporter, TestCase, TestModule, TestSuite } from "vitest/node";

export type EventSink = (
  type: RunEvent["type"],
  payload: Record<string, unknown>,
) => void | Promise<void>;

function suitePath(test: TestCase): Array<Record<string, unknown>> {
  const suites: Array<Record<string, unknown>> = [];
  let parent = test.parent;
  while (parent.type === "suite") {
    suites.unshift({
      id: parent.id,
      name: parent.name,
      location: parent.location,
    });
    parent = parent.parent;
  }
  return suites;
}

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
      suites: suitePath(test),
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
      suites: suitePath(test),
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
      location: suite.location,
    });
  }
  async onTestSuiteResult(suite: TestSuite): Promise<void> {
    await this.emit("suite.finished", {
      id: suite.id,
      moduleId: suite.module.id,
      name: suite.name,
      parentId: suite.parent.id,
      location: suite.location,
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
