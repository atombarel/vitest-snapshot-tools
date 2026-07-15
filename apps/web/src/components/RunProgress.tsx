import type {
  ReviewSession,
  RunProgress as RunProgressState,
} from "@vsnap/protocol";
import {
  CheckCircle2,
  Clock3,
  FileSearch,
  Layers,
  LoaderCircle,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  createEmptyRunProgress,
  formatElapsed,
  progressPhase,
} from "../run-progress.js";

export interface RunProgressProps {
  session: ReviewSession;
  progress: RunProgressState | undefined;
}

export function RunProgress({
  session,
  progress: liveProgress,
}: RunProgressProps) {
  const [now, setNow] = useState(Date.now());
  const progress = useMemo(
    () => liveProgress ?? createEmptyRunProgress(session.id),
    [liveProgress, session.id],
  );
  const phase = progressPhase(progress, session.state);
  const running = progress.currentTests;
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
            <div className="text-sm font-medium">{phase}</div>
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

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        {/* Snapshot changes are the point of the tool — lead with them. They
            surface during the post-test diff phase, so this stays 0 while
            tests are still executing. */}
        <span className="inline-flex items-center gap-1.5 rounded-md border border-info/30 bg-info/10 px-2 py-1 font-medium text-info">
          <FileSearch className="size-3.5" />
          <b className="tabular-nums">{progress.snapshotChanges}</b> snapshot
          {progress.snapshotChanges === 1 ? " update" : " updates"}
        </span>
        {progress.failed ? (
          <span className="flex items-center gap-1.5 text-destructive">
            <XCircle className="size-3.5" />
            <b className="font-medium tabular-nums">{progress.failed}</b> test
            {progress.failed === 1 ? " failure" : " failures"}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <CheckCircle2 className="size-3.5 text-success" />
            <b className="font-medium text-foreground tabular-nums">
              {progress.testsFinished}
            </b>{" "}
            tests completed
          </span>
        )}
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Layers className="size-3.5" />
          <b className="font-medium text-foreground tabular-nums">
            {progress.modulesFinished}
          </b>{" "}
          / {progress.modulesCollected} files
        </span>

        <div className="ml-auto flex min-w-0 items-center gap-2 text-muted-foreground">
          {running.length > 0 ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <LoaderCircle className="size-3.5 shrink-0 animate-spin text-info" />
              <span className="truncate">{running[0]?.name}</span>
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
                  {Math.round(test.durationMs ?? 0)}ms
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
