import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  Camera,
  CheckCircle2,
  ChevronRight,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { api } from "../api.js";

export function StartPage() {
  const project = useQuery({ queryKey: ["project"], queryFn: api.project });
  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: api.sessions,
    refetchInterval: 2000,
  });
  return (
    <main className="start-shell">
      <header className="start-topbar">
        <div className="brand">
          <div className="brand-mark">
            <Camera size={20} />
          </div>
          <div>
            <strong>Vitest Snapshot Tools</strong>
            <span>Transactional review workspace</span>
          </div>
        </div>
      </header>
      <section className="hero">
        <div className="eyebrow">
          <ShieldCheck size={14} /> Repository snapshots stay untouched during
          test runs
        </div>
        <h1>
          Review every snapshot
          <br />
          <em>before it lands.</em>
        </h1>
        <p>
          <code>{project.data?.repositoryRoot ?? "Loading repository…"}</code>
        </p>
      </section>
      <section className="session-card">
        <div className="section-heading">
          <div>
            <span className="kicker">Recent activity</span>
            <h2>Review sessions</h2>
          </div>
          <Activity size={20} />
        </div>
        {sessions.data?.length ? (
          sessions.data.map((session) => (
            <Link
              key={session.id}
              to="/runs/$sessionId/review"
              params={{ sessionId: session.id }}
              className="session-row"
            >
              <span className={`state-dot ${session.state}`} />
              <div>
                <strong>
                  {session.summary.snapshotChanges} snapshot{" "}
                  {session.summary.snapshotChanges === 1 ? "change" : "changes"}
                </strong>
                <small>
                  {session.id.slice(0, 8)} · revision {session.revision}
                </small>
              </div>
              <div className="session-stats">
                <span className="run-chip pass">
                  <CheckCircle2 size={13} /> {session.summary.passed}
                </span>
                <span className="run-chip fail">
                  <XCircle size={13} /> {session.summary.failed}
                </span>
                <span className="state-label">
                  <span className={`state-dot ${session.state}`} />
                  {session.state}
                </span>
              </div>
              <ChevronRight size={17} className="chevron" />
            </Link>
          ))
        ) : (
          <div className="empty">
            No sessions yet. Start one with{" "}
            <code>vsnap run -- [vitest args]</code>.
          </div>
        )}
      </section>
    </main>
  );
}
