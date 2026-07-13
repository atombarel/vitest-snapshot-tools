import { parseDiffFromFile } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Check,
  ChevronDown,
  CircleDot,
  Columns2,
  FileCode2,
  Moon,
  Play,
  RotateCcw,
  Search,
  Square,
  Sun,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api, subscribeEvents } from "../api.js";
import { inferSnapshotLanguage } from "../diff-language.js";
import { liveStore, reduceEvent } from "../store.js";

export function ReviewPage() {
  const params = useParams({ strict: false }) as {
    sessionId: string;
    entryId?: string;
  };
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState(params.entryId);
  const [filter, setFilter] = useState("");
  const [status, setStatus] = useState<string>();
  const [theme, setTheme] = useState(
    localStorage.getItem("vsnap-theme") ?? "system",
  );
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
  const diff = useQuery({
    queryKey: ["diff", params.sessionId, selected],
    queryFn: () => api.diff(params.sessionId, selected as string),
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
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("vsnap-theme", theme);
  }, [theme]);
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
  const diffLanguage = useMemo(
    () =>
      diff.data
        ? inferSnapshotLanguage(diff.data.baseline, diff.data.candidate)
        : undefined,
    [diff.data],
  );
  const fileDiff = useMemo(() => {
    if (!diff.data) return null;
    const extension = diffLanguage ?? "snap";
    return parseDiffFromFile(
      {
        name: `baseline.${extension}`,
        contents: diff.data.baseline,
        ...(diffLanguage ? { lang: diffLanguage } : {}),
        cacheKey: `b-${diff.data.hunks.map((h) => h.contentHash).join()}`,
      },
      {
        name: `candidate.${extension}`,
        contents: diff.data.candidate,
        ...(diffLanguage ? { lang: diffLanguage } : {}),
        cacheKey: `c-${diff.data.hunks.map((h) => h.contentHash).join()}`,
      },
      { context: 3 },
    );
  }, [diff.data, diffLanguage]);
  const decide = useMutation({
    mutationFn: ({
      selector,
      decision,
    }: {
      selector: string;
      decision: "accepted" | "rejected";
    }) =>
      api.decide(
        params.sessionId,
        selector,
        decision,
        session.data?.revision ?? 0,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["nodes", params.sessionId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["diff", params.sessionId],
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
        decide.mutate({ selector: selected, decision: "accepted" });
      if (event.key === "r")
        decide.mutate({ selector: selected, decision: "rejected" });
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
  }, [selected, list, decide.mutate]);
  const active = ["created", "collecting", "running", "cancelling"].includes(
    session.data?.state ?? "",
  );
  const totals = {
    pending: list.filter((n) => n.decision === "pending").length,
    accepted: list.filter((n) => n.decision === "accepted").length,
    rejected: list.filter((n) => n.decision === "rejected").length,
  };
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
        <div className="command">
          <span className={`pulse ${active ? "active" : ""}`} />
          <strong>{session.data?.state ?? "loading"}</strong>
          <code>vitest {session.data?.vitestArgs.join(" ")}</code>
        </div>
        <div className="run-stats">
          <span className="passed">
            {session.data?.summary.passed ?? 0} passed
          </span>
          <span className="failed">
            {session.data?.summary.failed ?? 0} failed
          </span>
          <span>{session.data?.summary.snapshotChanges ?? 0} changes</span>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
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
                    className={`tree-row ${selected === node.id ? "active" : ""}`}
                    style={{ transform: `translateY(${row.start}px)` }}
                    onClick={() => setSelected(node.id)}
                  >
                    <span className={`decision-dot ${node.decision}`} />
                    <span>
                      <strong>{node.label}</strong>
                      <small>
                        {node.changeType} · {node.childCount} hunks
                      </small>
                    </span>
                    <ChevronDown size={14} />
                  </button>
                );
              })}
            </div>
          </div>
        </aside>
        <main className="diff-panel">
          <div className="diff-toolbar">
            <div>
              <span className="breadcrumb">
                REVIEW / {selected?.slice(0, 14) ?? "SELECT AN ENTRY"}
                {diffLanguage === "json" ? (
                  <span className="language-badge">JSON</span>
                ) : null}
              </span>
              <h1>
                {list.find((item) => item.id === selected)?.label ??
                  "Choose a snapshot change"}
              </h1>
            </div>
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
          <div className="diff-scroll">
            {fileDiff ? (
              <FileDiff
                fileDiff={fileDiff}
                options={{
                  diffStyle: layout,
                  theme: { dark: "github-dark", light: "github-light" },
                  lineDiffType:
                    diff.data &&
                    Math.max(
                      diff.data.baseline.length,
                      diff.data.candidate.length,
                    ) > 500_000
                      ? "none"
                      : "word-alt",
                  hunkSeparators: "line-info",
                }}
              />
            ) : (
              <div className="diff-empty">
                <FileCode2 size={36} />
                <strong>No snapshot selected</strong>
                <span>
                  Select an entry from the index to inspect its exact candidate
                  diff.
                </span>
              </div>
            )}
          </div>
        </main>
        <aside className="decision-panel">
          <div className="panel-title">
            <div>
              <span className="kicker">Review state</span>
              <strong>Decision</strong>
            </div>
            <CircleDot size={18} />
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
              disabled={!selected}
              className="accept"
              onClick={() =>
                selected &&
                decide.mutate({ selector: selected, decision: "accepted" })
              }
            >
              <Check size={16} /> Accept entry <kbd>A</kbd>
            </button>
            <button
              type="button"
              disabled={!selected}
              className="reject"
              onClick={() =>
                selected &&
                decide.mutate({ selector: selected, decision: "rejected" })
              }
            >
              <X size={16} /> Reject entry <kbd>R</kbd>
            </button>
          </div>
          <div className="notice">
            <strong>Incremental apply</strong>
            <p>
              Only accepted hunks change repository files. Pending candidates
              stay in this session after the revision advances.
            </p>
          </div>
          <div className="live-card">
            <span className="kicker">Live activity</span>
            {Object.values(live.runningTests)
              .slice(0, 3)
              .map((name) => (
                <div key={name}>
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
          <div className="apply-block">
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
