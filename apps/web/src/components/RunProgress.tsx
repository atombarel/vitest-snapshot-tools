import type { ReviewSession, RunEvent } from "@vsnap/protocol";
import {
  CheckCircle2,
  Clock3,
  FileSearch,
  Layers,
  LoaderCircle,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatElapsed, summarizeRunProgress } from "../run-progress.js";

export interface RunProgressProps {
  session: ReviewSession;
  events: RunEvent[];
  runningTests: Record<string, string>;
}

export function RunProgress({
  session,
  events,
  runningTests,
}: RunProgressProps) {
  const [now, setNow] = useState(Date.now());
  const progress = useMemo(
    () => summarizeRunProgress(events, session.state),
    [events, session.state],
  );
  const running = Object.values(runningTests);
  const percent = progress.testsDiscovered
    ? Math.min(100, (progress.testsFinished / progress.testsDiscovered) * 100)
    : 0;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section
      className="border-b bg-muted/40 px-4 py-3"
      aria-label="Test run progress"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <LoaderCircle className="size-4 animate-spin text-info" />
          <div className="leading-tight">
            <div className="text-sm font-medium">{progress.phase}</div>
            <div className="text-xs text-muted-foreground">
              {progress.testsDiscovered
                ? `${progress.testsFinished} of ${progress.testsDiscovered} discovered tests finished`
                : "Waiting for Vitest to report discovered tests"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground tabular-nums">
          <Clock3 className="size-3.5" />
          {formatElapsed(now - new Date(session.createdAt).getTime())}
        </div>
      </div>

      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-label="Test execution progress"
        aria-valuemin={0}
        aria-valuemax={progress.testsDiscovered || undefined}
        aria-valuenow={
          progress.testsDiscovered ? progress.testsFinished : undefined
        }
      >
        <span
          className={`block h-full rounded-full bg-info transition-[width] duration-500 ${progress.testsDiscovered ? "" : "animate-pulse"}`}
          style={{ width: `${progress.testsDiscovered ? percent : 40}%` }}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <CheckCircle2 className="size-3.5 text-success" />
          <b className="font-semibold text-foreground tabular-nums">
            {progress.passed}
          </b>{" "}
          passed
        </span>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <XCircle
            className={`size-3.5 ${progress.failed ? "text-destructive" : ""}`}
          />
          <b className="font-semibold text-foreground tabular-nums">
            {progress.failed}
          </b>{" "}
          failed
        </span>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <FileSearch className="size-3.5" />
          <b className="font-semibold text-foreground tabular-nums">
            {progress.snapshotChanges}
          </b>{" "}
          changes
        </span>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Layers className="size-3.5" />
          <b className="font-semibold text-foreground tabular-nums">
            {progress.modulesFinished}
          </b>{" "}
          / {progress.modulesCollected} files
        </span>

        <div className="ml-auto flex min-w-0 items-center gap-2 text-muted-foreground">
          {running.length > 0 ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <LoaderCircle className="size-3.5 shrink-0 animate-spin text-info" />
              <span className="truncate">{running[0]}</span>
            </span>
          ) : progress.recentTests.length > 0 ? (
            progress.recentTests.slice(0, 1).map((test) => (
              <span key={test.id} className="flex min-w-0 items-center gap-1.5">
                {test.status === "failed" ? (
                  <XCircle className="size-3.5 shrink-0 text-destructive" />
                ) : (
                  <CheckCircle2 className="size-3.5 shrink-0 text-success" />
                )}
                <span className="truncate">{test.name}</span>
                <span className="tabular-nums">
                  {Math.round(test.durationMs)}ms
                </span>
              </span>
            ))
          ) : (
            <span className="flex items-center gap-1.5">
              <LoaderCircle className="size-3.5 animate-spin" />
              Connecting to live activity…
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
