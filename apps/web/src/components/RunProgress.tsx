import type { ReviewSession, RunEvent } from "@vsnap/protocol";
import {
  CheckCircle2,
  CircleDot,
  Clock3,
  FileSearch,
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
      className="run-progress-panel"
      aria-label="Test run progress"
      aria-live="polite"
    >
      <div className="run-progress-heading">
        <div>
          <LoaderCircle className="run-progress-spinner" size={17} />
          <span>
            <strong>{progress.phase}</strong>
            <small>
              {progress.testsDiscovered
                ? `${progress.testsFinished} of ${progress.testsDiscovered} discovered tests finished`
                : "Waiting for Vitest to report discovered tests"}
            </small>
          </span>
        </div>
        <code>
          <Clock3 size={13} />
          {formatElapsed(now - new Date(session.createdAt).getTime())}
        </code>
      </div>
      <div
        className={`run-execution-bar ${progress.testsDiscovered ? "" : "indeterminate"}`}
        role="progressbar"
        aria-label="Test execution progress"
        aria-valuemin={0}
        aria-valuemax={progress.testsDiscovered || undefined}
        aria-valuenow={
          progress.testsDiscovered ? progress.testsFinished : undefined
        }
      >
        <span
          style={{
            width: `${progress.testsDiscovered ? percent : 28}%`,
          }}
        />
      </div>
      <div className="run-progress-detail">
        <div className="run-progress-metrics">
          <span>
            <CheckCircle2 /> <b>{progress.passed}</b> passed
          </span>
          <span className={progress.failed ? "failed" : ""}>
            <XCircle /> <b>{progress.failed}</b> failed
          </span>
          <span>
            <FileSearch /> <b>{progress.snapshotChanges}</b> changes
          </span>
          <span>
            <CircleDot /> <b>{progress.modulesFinished}</b> /{" "}
            {progress.modulesCollected} files
          </span>
        </div>
        <div className="run-progress-activity">
          {running.length > 0 ? (
            running.slice(0, 2).map((name) => (
              <span className="running" key={name}>
                <LoaderCircle /> {name}
              </span>
            ))
          ) : progress.recentTests.length > 0 ? (
            progress.recentTests.slice(0, 2).map((test) => (
              <span className={test.status} key={test.id}>
                {test.status === "failed" ? <XCircle /> : <CheckCircle2 />}
                {test.name}
                <small>{Math.round(test.durationMs)}ms</small>
              </span>
            ))
          ) : (
            <span className="waiting">
              <LoaderCircle /> Connecting to live test activity…
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
