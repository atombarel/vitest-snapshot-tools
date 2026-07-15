import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Aperture, ChevronRight, GitBranch } from "lucide-react";
import { api } from "../api.js";
import { Badge } from "../components/ui/badge.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card.js";

const activeStates = new Set([
  "created",
  "collecting",
  "running",
  "cancelling",
]);

function stateTone(state: string): string {
  if (state === "failed") return "bg-destructive";
  if (activeStates.has(state)) return "bg-info";
  return "bg-success";
}

export function StartPage() {
  const project = useQuery({ queryKey: ["project"], queryFn: api.project });
  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: api.sessions,
    refetchInterval: 2000,
  });
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-6">
        <div className="flex size-9 items-center justify-center rounded-lg border bg-card text-foreground">
          <Aperture className="size-5" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold">Vitest Snapshot Tools</div>
          <div className="text-xs text-muted-foreground">
            Transactional review workspace
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 pb-24">
        <section className="pt-10 pb-12">
          <Badge variant="secondary" className="gap-1.5 font-normal">
            <GitBranch className="size-3" />
            Repository snapshots stay untouched during test runs
          </Badge>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight text-balance">
            Review every snapshot
            <br />
            before it lands.
          </h1>
          <p className="mt-4 text-sm text-muted-foreground">
            Working in{" "}
            <code className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
              {project.data?.repositoryRoot ?? "Loading repository…"}
            </code>
          </p>
        </section>

        <Card className="gap-0 py-0 overflow-hidden">
          <CardHeader className="border-b py-5">
            <CardTitle className="text-base">Review sessions</CardTitle>
            <CardDescription>
              Recent runs streamed from your local Vitest instance
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {sessions.data?.length ? (
              <ul className="divide-y">
                {sessions.data.map((session) => (
                  <li key={session.id}>
                    <Link
                      to="/runs/$sessionId/review"
                      params={{ sessionId: session.id }}
                      className="group flex items-center gap-4 px-6 py-4 transition-colors hover:bg-accent/60"
                    >
                      <span
                        className={`size-2 shrink-0 rounded-full ${stateTone(session.state)}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {session.summary.snapshotChanges} snapshot{" "}
                          {session.summary.snapshotChanges === 1
                            ? "update"
                            : "updates"}
                        </div>
                        <div className="truncate font-mono text-xs text-muted-foreground">
                          {session.id.slice(0, 8)} · revision {session.revision}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="tabular-nums">
                          {session.summary.total} tests
                        </Badge>
                        {session.summary.failed ? (
                          <Badge variant="destructive" className="tabular-nums">
                            {session.summary.failed} failed
                          </Badge>
                        ) : null}
                        <span className="hidden w-16 text-xs text-muted-foreground capitalize sm:inline">
                          {session.state}
                        </span>
                      </div>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-6 py-14 text-center text-sm text-muted-foreground">
                No sessions yet. Start one with{" "}
                <code className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                  vsnap run -- [vitest args]
                </code>
                .
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
