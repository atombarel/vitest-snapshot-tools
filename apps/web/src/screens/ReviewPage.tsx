import { parseDiffFromFile } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Check,
  Code2,
  Columns2,
  FileCode2,
  Info,
  Monitor,
  Moon,
  Play,
  RotateCcw,
  Search,
  Square,
  Sun,
  X,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api, subscribeEvents } from "../api.js";
import { inferSnapshotLanguage } from "../diff-language.js";
import { matcherInvocation } from "../snapshot-context.js";
import { liveStore, reduceEvent } from "../store.js";
import { nextThemeMode, parseThemeMode, resolveTheme } from "../theme.js";

const SourceCodeView = lazy(() =>
  import("../components/SourceCodeView.js").then((module) => ({
    default: module.SourceCodeView,
  })),
);

function changeGlyph(changeType?: string): string {
  if (changeType === "added") return "+";
  if (changeType === "deleted") return "−";
  return "~";
}

export function ReviewPage() {
  const params = useParams({ strict: false }) as {
    sessionId: string;
    entryId?: string;
  };
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState(params.entryId);
  const [filter, setFilter] = useState("");
  const [status, setStatus] = useState<string>();
  const [themeMode, setThemeMode] = useState(() =>
    parseThemeMode(localStorage.getItem("vsnap-theme")),
  );
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  );
  const resolvedTheme = resolveTheme(themeMode, systemPrefersDark);
  const [layout, setLayout] = useState<"split" | "unified">("split");
  const session = useQuery({
    queryKey: ["session", params.sessionId],
    queryFn: () => api.session(params.sessionId),
    refetchInterval: 1500,
  });
  const nodes = useQuery({
    queryKey: ["nodes", params.sessionId, status],
    queryFn: () => api.nodes(params.sessionId, "entry", status),
    refetchInterval: 2000,
  });
  const review = useQuery({
    queryKey: ["review", params.sessionId, selected],
    queryFn: () => api.review(params.sessionId, selected as string),
    enabled: Boolean(selected),
  });
  const live = useStore(liveStore, (value) => value);
  useEffect(() => {
    const controller = new AbortController();
    void subscribeEvents(
      params.sessionId,
      liveStore.state.sequence,
      reduceEvent,
      controller.signal,
    ).catch(() => undefined);
    return () => controller.abort();
  }, [params.sessionId]);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query) return;
    const update = (event: MediaQueryListEvent) =>
      setSystemPrefersDark(event.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.themeMode = themeMode;
    localStorage.setItem("vsnap-theme", themeMode);
  }, [themeMode, resolvedTheme]);
  const list = useMemo(
    () =>
      (nodes.data?.items ?? []).filter((node) =>
        node.label.toLowerCase().includes(filter.toLowerCase()),
      ),
    [nodes.data, filter],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: list.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 47,
    overscan: 12,
  });
  const renderedEntries = useMemo(
    () =>
      (review.data?.entries ?? []).map((entry) => {
        const language = inferSnapshotLanguage(entry.baseline, entry.candidate);
        const extension = language ?? "snap";
        return {
          entry,
          language,
          fileDiff: parseDiffFromFile(
            {
              name: `baseline.${extension}`,
              contents: entry.baseline,
              ...(language ? { lang: language } : {}),
              cacheKey: `b-${entry.hunks.map((h) => h.contentHash).join()}`,
            },
            {
              name: `candidate.${extension}`,
              contents: entry.candidate,
              ...(language ? { lang: language } : {}),
              cacheKey: `c-${entry.hunks.map((h) => h.contentHash).join()}`,
            },
            { context: 3 },
          ),
        };
      }),
    [review.data],
  );
  const visibleEntryIds = useMemo(
    () => review.data?.entries.map((entry) => entry.entryId) ?? [],
    [review.data],
  );
  const linkedHookCount =
    review.data?.source.blocks.filter((block) => block.kind !== "test")
      .length ?? 0;
  const decide = useMutation({
    mutationFn: ({
      selectors,
      decision,
    }: {
      selectors: string[];
      decision: "accepted" | "rejected";
    }) =>
      selectors.reduce<Promise<unknown>>(
        (pending, selector) =>
          pending.then(() =>
            api.decide(
              params.sessionId,
              selector,
              decision,
              session.data?.revision ?? 0,
            ),
          ),
        Promise.resolve(),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["nodes", params.sessionId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["review", params.sessionId],
      });
    },
    onError: (error) => toast.error(error.message),
  });
  const apply = useMutation({
    mutationFn: () => api.apply(params.sessionId, session.data?.revision ?? 0),
    onSuccess: async (result) => {
      toast.success(`${result.code}: ${result.written.length} files updated`);
      await queryClient.invalidateQueries();
    },
    onError: (error) => toast.error(error.message),
  });
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!selected || event.target instanceof HTMLInputElement) return;
      if (event.key === "a")
        decide.mutate({ selectors: visibleEntryIds, decision: "accepted" });
      if (event.key === "r")
        decide.mutate({ selectors: visibleEntryIds, decision: "rejected" });
      if (event.key === "j" || event.key === "k") {
        const index = list.findIndex((item) => item.id === selected);
        setSelected(
          list[
            Math.max(
              0,
              Math.min(list.length - 1, index + (event.key === "j" ? 1 : -1)),
            )
          ]?.id,
        );
      }
    };
    addEventListener("keydown", handler);
    return () => removeEventListener("keydown", handler);
  }, [selected, list, visibleEntryIds, decide.mutate]);
  const active = ["created", "collecting", "running", "cancelling"].includes(
    session.data?.state ?? "",
  );
  const totals = {
    pending: list.filter((n) => n.decision === "pending").length,
    accepted: list.filter((n) => n.decision === "accepted").length,
    rejected: list.filter((n) => n.decision === "rejected").length,
  };
  const totalPercent = (count: number) =>
    list.length ? (count / list.length) * 100 : 0;
  return (
    <div className="review-shell">
      <header className="runbar">
        <div className="brand compact">
          <div className="brand-mark">
            <FileCode2 size={17} />
          </div>
          <div>
            <strong>vsnap</strong>
            <span>{session.data?.repositoryRoot.split("/").at(-1)}</span>
          </div>
        </div>
        <span className="divider" />
        <div className="command">
          <span className="status-pill">
            <span className={`pulse ${active ? "active" : ""}`} />
            {session.data?.state ?? "loading"}
          </span>
          <code>vitest {session.data?.vitestArgs.join(" ")}</code>
        </div>
        <div className="run-stats">
          <span className="stat pass">
            <b>{session.data?.summary.passed ?? 0}</b> passed
          </span>
          <span className="stat fail">
            <b>{session.data?.summary.failed ?? 0}</b> failed
          </span>
          <span className="stat changes">
            <b>{session.data?.summary.snapshotChanges ?? 0}</b> changes
          </span>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={() => setThemeMode(nextThemeMode(themeMode))}
          aria-label={`Theme: ${themeMode}. Switch theme`}
          title={`Theme: ${themeMode} (${resolvedTheme})`}
        >
          {themeMode === "system" ? (
            <Monitor size={16} />
          ) : themeMode === "dark" ? (
            <Moon size={16} />
          ) : (
            <Sun size={16} />
          )}
        </button>
        {active ? (
          <button
            type="button"
            className="button subtle"
            onClick={() => api.cancel(params.sessionId)}
          >
            <Square size={13} /> Cancel
          </button>
        ) : (
          <button
            type="button"
            className="button subtle"
            onClick={() => api.rerun(params.sessionId)}
          >
            <RotateCcw size={13} /> Rerun
          </button>
        )}
      </header>
      <div className="workspace">
        <aside className="tree-panel">
          <div className="panel-title">
            <div>
              <span className="kicker">Candidate index</span>
              <strong>Snapshot changes</strong>
            </div>
            <span className="count">{list.length}</span>
          </div>
          <div className="search">
            <Search size={14} />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter tests and entries…"
            />
          </div>
          <div className="filter-row">
            {[undefined, "pending", "accepted", "rejected"].map((value) => (
              <button
                type="button"
                key={value ?? "all"}
                className={status === value ? "selected" : ""}
                onClick={() => setStatus(value)}
              >
                {value ?? "all"}
              </button>
            ))}
          </div>
          <div className="virtual-list" ref={scrollRef}>
            <div
              style={{
                height: virtualizer.getTotalSize(),
                position: "relative",
              }}
            >
              {virtualizer.getVirtualItems().map((row) => {
                const node = list[row.index];
                if (!node) return null;
                return (
                  <button
                    type="button"
                    key={node.id}
                    className={`tree-row ${node.decision} ${node.changeType ?? ""} ${selected === node.id ? "active" : ""}`}
                    style={{ transform: `translateY(${row.start}px)` }}
                    onClick={() => setSelected(node.id)}
                  >
                    <span className={`decision-dot ${node.decision}`} />
                    <span>
                      <strong>{node.label}</strong>
                      <small>
                        {node.changeType} · {node.childCount} hunk
                        {node.childCount === 1 ? "" : "s"}
                      </small>
                    </span>
                    <span
                      className={`tree-badge ${node.changeType ?? ""}`}
                      aria-hidden="true"
                    >
                      {changeGlyph(node.changeType)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>
        <main className="diff-panel">
          <div className="diff-toolbar">
            <div>
              <span className="breadcrumb">TEST REVIEW</span>
              <h1>{review.data?.test?.name ?? "Choose a snapshot change"}</h1>
            </div>
            <div className="toolbar-actions">
              <div className="segmented">
                <button
                  type="button"
                  className={layout === "split" ? "selected" : ""}
                  onClick={() => setLayout("split")}
                >
                  <Columns2 size={14} /> Split
                </button>
                <button
                  type="button"
                  className={layout === "unified" ? "selected" : ""}
                  onClick={() => setLayout("unified")}
                >
                  Unified
                </button>
              </div>
            </div>
          </div>
          <div className="diff-scroll">
            {review.data ? (
              <div className="test-review-stack">
                <section className="test-source-section">
                  <div className="review-section-heading">
                    <div>
                      <div>
                        <strong>Test source</strong>
                        <span>{review.data.source.relativePath}</span>
                      </div>
                    </div>
                    <span>
                      {linkedHookCount
                        ? `${linkedHookCount} linked hook${linkedHookCount === 1 ? "" : "s"}`
                        : "No linked hooks"}{" "}
                      · read only
                    </span>
                  </div>
                  <Suspense
                    fallback={
                      <div className="source-inline-loading">
                        <Code2 size={20} /> Coloring test source…
                      </div>
                    }
                  >
                    <SourceCodeView
                      source={review.data.source}
                      theme={resolvedTheme}
                    />
                  </Suspense>
                </section>
                <section
                  className="snapshot-chunks"
                  aria-label="Snapshot chunks generated by this test"
                >
                  <div className="review-section-heading">
                    <div>
                      <div>
                        <strong>Snapshot changes</strong>
                        <span>Baseline → candidate</span>
                      </div>
                    </div>
                    <span>
                      {renderedEntries.length} chunk
                      {renderedEntries.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  {renderedEntries.map((item, index) => (
                    <article
                      className="snapshot-chunk"
                      key={item.entry.entryId}
                    >
                      <header className="snapshot-chunk-header">
                        <div>
                          <strong className="snapshot-chunk-title">
                            {item.entry.context.snapshotName ??
                              `Snapshot ${index + 1}`}
                          </strong>
                          <code>{matcherInvocation(item.entry.context)}</code>
                        </div>
                        <div>
                          {item.language === "json" ? (
                            <span className="language-badge">JSON</span>
                          ) : null}
                          <span
                            className={`change-badge ${item.entry.context.changeType}`}
                          >
                            {item.entry.context.changeType}
                          </span>
                        </div>
                      </header>
                      <FileDiff
                        fileDiff={item.fileDiff}
                        options={{
                          diffStyle: layout,
                          theme: {
                            dark: "one-dark-pro",
                            light: "github-light",
                          },
                          lineDiffType:
                            Math.max(
                              item.entry.baseline.length,
                              item.entry.candidate.length,
                            ) > 500_000
                              ? "none"
                              : "word-alt",
                          hunkSeparators: "line-info",
                        }}
                      />
                    </article>
                  ))}
                </section>
              </div>
            ) : review.isError ? (
              <div className="diff-empty source-error">
                <FileCode2 size={36} />
                <strong>Test review unavailable</strong>
                <span>{review.error.message}</span>
              </div>
            ) : (
              <div className="diff-empty">
                <FileCode2 size={36} />
                <strong>
                  {selected ? "Loading test review…" : "No snapshot selected"}
                </strong>
                <span>
                  Select an entry to see its exact test source and every
                  snapshot produced by that test.
                </span>
              </div>
            )}
          </div>
        </main>
        <aside className="decision-panel">
          <div className="panel-title">
            <div>
              <span className="kicker">Review state</span>
              <strong>Decisions</strong>
            </div>
            <span className="count">{list.length}</span>
          </div>
          <div className="decision-body">
            <div className="decision-progress">
              <div className="decision-progress-bar">
                <span
                  className="seg-accepted"
                  style={{ width: `${totalPercent(totals.accepted)}%` }}
                />
                <span
                  className="seg-rejected"
                  style={{ width: `${totalPercent(totals.rejected)}%` }}
                />
                <span
                  className="seg-pending"
                  style={{ width: `${totalPercent(totals.pending)}%` }}
                />
              </div>
              <div className="decision-progress-caption">
                <span>Review progress</span>
                <span>
                  <b>{totals.accepted + totals.rejected}</b> / {list.length}{" "}
                  decided
                </span>
              </div>
            </div>
            <div className="decision-totals">
              <div>
                <strong>{totals.pending}</strong>
                <span>Pending</span>
              </div>
              <div>
                <strong>{totals.accepted}</strong>
                <span>Accepted</span>
              </div>
              <div>
                <strong>{totals.rejected}</strong>
                <span>Rejected</span>
              </div>
            </div>
            <div className="decision-actions">
              <button
                type="button"
                disabled={visibleEntryIds.length === 0 || decide.isPending}
                className="accept"
                onClick={() =>
                  decide.mutate({
                    selectors: visibleEntryIds,
                    decision: "accepted",
                  })
                }
              >
                <Check size={16} /> Accept test snapshots <kbd>A</kbd>
              </button>
              <button
                type="button"
                disabled={visibleEntryIds.length === 0 || decide.isPending}
                className="reject"
                onClick={() =>
                  decide.mutate({
                    selectors: visibleEntryIds,
                    decision: "rejected",
                  })
                }
              >
                <X size={16} /> Reject test snapshots <kbd>R</kbd>
              </button>
            </div>
            <div className="notice">
              <strong>
                <Info size={13} /> Incremental apply
              </strong>
              <p>
                Only accepted hunks change repository files. Pending candidates
                stay in this session after the revision advances.
              </p>
            </div>
            <div className="live-card">
              <span className="kicker">
                <Play size={12} /> Live activity
              </span>
              {Object.values(live.runningTests).length === 0 &&
              live.console.length === 0 ? (
                <span className="live-idle">Idle — no live output</span>
              ) : null}
              {Object.values(live.runningTests)
                .slice(0, 3)
                .map((name) => (
                  <div className="live-test" key={name}>
                    <Play size={11} />
                    {name}
                  </div>
                ))}
              {live.console.slice(-3).map((event) => (
                <code key={event.sequence}>
                  {String(event.payload.content).trim()}
                </code>
              ))}
            </div>
            <div className="shortcuts-card">
              <span className="kicker">Keyboard</span>
              <div className="shortcut-row">
                <span>Navigate entries</span>
                <span>
                  <kbd>J</kbd>
                  <kbd>K</kbd>
                </span>
              </div>
              <div className="shortcut-row">
                <span>Accept snapshots</span>
                <kbd>A</kbd>
              </div>
              <div className="shortcut-row">
                <span>Reject snapshots</span>
                <kbd>R</kbd>
              </div>
            </div>
          </div>
          <div className="apply-block">
            <div className="apply-summary">
              <span>Ready to apply</span>
              <span>
                <b>{totals.accepted}</b> accepted
              </span>
            </div>
            <button
              type="button"
              disabled={active || apply.isPending}
              className="button primary"
              onClick={() => apply.mutate()}
            >
              {apply.isPending ? "Applying…" : "Preview & apply accepted"}
            </button>
            <small>
              {active
                ? "Apply unlocks when the run finishes"
                : "Hash-protected · no Git operations"}
            </small>
          </div>
        </aside>
      </div>
    </div>
  );
}
