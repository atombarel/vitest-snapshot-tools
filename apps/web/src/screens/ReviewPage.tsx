import { parseDiffFromFile } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Code2,
  Columns2,
  FileCode2,
  LoaderCircle,
  Monitor,
  Moon,
  RotateCcw,
  Rows2,
  Search,
  Square,
  Sun,
  X,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api, subscribeProgress } from "../api.js";
import { RunProgress } from "../components/RunProgress.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { Kbd } from "../components/ui/kbd.js";
import { Separator } from "../components/ui/separator.js";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { inferSnapshotLanguage } from "../diff-language.js";
import {
  hasUnappliedReviewProgress,
  RERUN_PROGRESS_WARNING,
  useProgressLossWarning,
} from "../review-progress.js";
import { matcherInvocation, snapshotTitle } from "../snapshot-context.js";
import { beginLiveSession, liveStore, reduceProgress } from "../store.js";
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

function changeTone(changeType?: string): string {
  if (changeType === "added")
    return "border-success/30 bg-success/10 text-success";
  if (changeType === "deleted")
    return "border-destructive/30 bg-destructive/10 text-destructive";
  return "border-border bg-muted text-muted-foreground";
}

function decisionTone(decision?: string): string {
  if (decision === "accepted") return "bg-success";
  if (decision === "rejected") return "bg-destructive";
  return "bg-warning";
}

export function ReviewPage() {
  const params = useParams({ strict: false }) as {
    sessionId: string;
    entryId?: string;
  };
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [selected, setSelected] = useState(params.entryId);
  const [selectedSourceEntryId, setSelectedSourceEntryId] = useState<string>();
  const [grouping, setGrouping] = useState<"family" | "test">("family");
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
    queryKey: ["nodes", params.sessionId, grouping, status],
    queryFn: () => api.nodes(params.sessionId, grouping, status),
    refetchInterval: 2000,
  });
  const progressNodes = useQuery({
    queryKey: ["nodes", params.sessionId, "family", undefined],
    queryFn: () => api.nodes(params.sessionId, "family"),
    refetchInterval: 2000,
  });
  const hasUnappliedProgress = hasUnappliedReviewProgress(
    progressNodes.data?.items ?? [],
  );
  const activeNode = (nodes.data?.items ?? []).find(
    (node) => node.id === selected || node.entryId === selected,
  );
  const reviewEntryId = activeNode?.entryId ?? selected;
  const review = useQuery({
    queryKey: ["review", params.sessionId, reviewEntryId],
    queryFn: () => api.review(params.sessionId, reviewEntryId as string),
    enabled: Boolean(reviewEntryId),
  });
  const sourceOccurrences =
    activeNode?.kind === "family" ? (review.data?.occurrences ?? []) : [];
  const selectedSourceOccurrence =
    sourceOccurrences.find(
      (occurrence) => occurrence.entryId === selectedSourceEntryId,
    ) ?? sourceOccurrences[0];
  const sourceOccurrenceIndex = Math.max(
    0,
    sourceOccurrences.indexOf(
      selectedSourceOccurrence as (typeof sourceOccurrences)[number],
    ),
  );
  const sourceReviewEntryId = selectedSourceOccurrence?.entryId;
  const nextSourceEntryId =
    sourceOccurrences[sourceOccurrenceIndex + 1]?.entryId;
  const occurrenceReview = useQuery({
    queryKey: ["occurrence-review", params.sessionId, sourceReviewEntryId],
    queryFn: () => api.review(params.sessionId, sourceReviewEntryId as string),
    enabled: Boolean(
      activeNode?.kind === "family" &&
        sourceReviewEntryId &&
        sourceReviewEntryId !== reviewEntryId,
    ),
  });
  const displayedSource =
    activeNode?.kind === "family" && sourceReviewEntryId !== reviewEntryId
      ? occurrenceReview.data?.source
      : review.data?.source;
  useEffect(() => {
    if (
      activeNode?.kind !== "family" ||
      !nextSourceEntryId ||
      nextSourceEntryId === reviewEntryId
    )
      return;
    void queryClient.prefetchQuery({
      queryKey: ["occurrence-review", params.sessionId, nextSourceEntryId],
      queryFn: () => api.review(params.sessionId, nextSourceEntryId),
    });
  }, [
    activeNode?.kind,
    nextSourceEntryId,
    params.sessionId,
    queryClient,
    reviewEntryId,
  ]);
  const live = useStore(liveStore, (value) => value);
  const liveProgress =
    live.sessionId === params.sessionId ? live.progress : undefined;
  // A rerun navigates to a new child session while keeping this component
  // mounted; clear selection/filters so nothing stale leaks across.
  const previousSessionId = useRef(params.sessionId);
  useEffect(() => {
    if (previousSessionId.current === params.sessionId) return;
    previousSessionId.current = params.sessionId;
    setSelected(undefined);
    setSelectedSourceEntryId(undefined);
    setFilter("");
    setStatus(undefined);
  }, [params.sessionId]);
  useEffect(() => {
    const controller = new AbortController();
    beginLiveSession(params.sessionId);
    void subscribeProgress(
      params.sessionId,
      reduceProgress,
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
  useEffect(() => {
    if (!selected && list[0]) {
      setSelected(list[0].id);
      setSelectedSourceEntryId(undefined);
    }
  }, [list, selected]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: list.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 60,
    overscan: 12,
  });
  const renderedEntries = useMemo(
    () =>
      (review.data?.entries ?? [])
        .filter(
          (entry) =>
            activeNode?.kind !== "family" ||
            entry.entryId === activeNode.entryId,
        )
        .map((entry) => {
          const language = inferSnapshotLanguage(
            entry.baseline,
            entry.candidate,
          );
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
    [activeNode?.entryId, activeNode?.kind, review.data],
  );
  const visibleEntryIds = useMemo(
    () => review.data?.entries.map((entry) => entry.entryId) ?? [],
    [review.data],
  );
  const decisionSelectors = useMemo(
    () => (activeNode?.kind === "family" ? [activeNode.id] : visibleEntryIds),
    [activeNode, visibleEntryIds],
  );
  const selectedIndex = list.findIndex(
    (item) => item.id === selected || item.entryId === selected,
  );
  const nextReviewId =
    selectedIndex >= 0 ? list[selectedIndex + 1]?.id : undefined;
  const linkedBlocks =
    displayedSource?.blocks.filter((block) => block.kind !== "test") ?? [];
  const linkedHookCount = linkedBlocks.filter((block) =>
    ["beforeAll", "beforeEach", "afterEach", "afterAll"].includes(block.kind),
  ).length;
  const linkedContextCount = linkedBlocks.length - linkedHookCount;
  const decide = useMutation({
    mutationFn: ({
      selectors,
      decision,
    }: {
      selectors: string[];
      decision: "accepted" | "rejected";
      nextReviewId?: string;
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
    onSuccess: async (_result, variables) => {
      if (variables.nextReviewId) {
        setSelected(variables.nextReviewId);
        setSelectedSourceEntryId(undefined);
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["nodes", params.sessionId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["review", params.sessionId],
        }),
      ]);
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
  const rerun = useMutation({
    mutationFn: () => api.rerun(params.sessionId),
    onSuccess: (child) => {
      // rerun() spawns a fresh child session with its own event stream, so
      // navigate to it: the session/nodes queries and the live SSE all
      // re-initialise exactly like the first load, showing live progress.
      queryClient.setQueryData(["session", child.id], child);
      void navigate({
        to: "/runs/$sessionId/review",
        params: { sessionId: child.id },
      });
    },
    onError: (error) => toast.error(error.message),
  });
  const startRerun = () => {
    if (hasUnappliedProgress && !window.confirm(RERUN_PROGRESS_WARNING)) return;
    rerun.mutate();
  };
  const cancel = useMutation({
    mutationFn: () => api.cancel(params.sessionId),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["session", params.sessionId],
      }),
    onError: (error) => toast.error(error.message),
  });
  useProgressLossWarning(
    hasUnappliedProgress || decide.isPending || apply.isPending,
  );
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!selected || event.target instanceof HTMLInputElement) return;
      if (event.key === "a")
        decide.mutate({
          selectors: decisionSelectors,
          decision: "accepted",
          ...(nextReviewId ? { nextReviewId } : {}),
        });
      if (event.key === "r")
        decide.mutate({
          selectors: decisionSelectors,
          decision: "rejected",
          ...(nextReviewId ? { nextReviewId } : {}),
        });
      if (event.key === "j" || event.key === "k") {
        const index = list.findIndex(
          (item) => item.id === selected || item.entryId === selected,
        );
        setSelected(
          list[
            Math.max(
              0,
              Math.min(list.length - 1, index + (event.key === "j" ? 1 : -1)),
            )
          ]?.id,
        );
        setSelectedSourceEntryId(undefined);
      }
    };
    addEventListener("keydown", handler);
    return () => removeEventListener("keydown", handler);
  }, [selected, list, decisionSelectors, nextReviewId, decide.mutate]);
  const active = ["created", "collecting", "running", "cancelling"].includes(
    session.data?.state ?? "",
  );
  const runFailed =
    session.data?.state === "failed" || (session.data?.summary.failed ?? 0) > 0;
  const totals = {
    pending: list.filter((n) => n.decision === "pending").length,
    accepted: list.filter((n) => n.decision === "accepted").length,
    rejected: list.filter((n) => n.decision === "rejected").length,
  };
  const decided = totals.accepted + totals.rejected;
  const pct = (count: number) =>
    list.length ? (count / list.length) * 100 : 0;
  const hasSelection = decisionSelectors.length > 0;

  return (
    <TooltipProvider>
      <div className="review-shell flex h-screen flex-col overflow-hidden">
        {/* Top app bar */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-md border bg-card">
              <FileCode2 className="size-4" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold">vsnap</div>
              <div className="max-w-40 truncate text-xs text-muted-foreground">
                {session.data?.repositoryRoot.split("/").at(-1)}
              </div>
            </div>
          </div>

          <Separator orientation="vertical" className="!h-6" />

          <div className="flex min-w-0 items-center gap-2.5">
            <Badge
              variant={active ? "secondary" : "outline"}
              className="gap-1.5 capitalize"
            >
              <span
                className={`size-1.5 rounded-full ${active ? "animate-pulse bg-info" : runFailed ? "bg-destructive" : "bg-success"}`}
              />
              {session.data?.state ?? "loading"}
            </Badge>
            <code className="hidden truncate font-mono text-xs text-muted-foreground md:block">
              vitest {session.data?.vitestArgs.join(" ")}
            </code>
          </div>

          <div className="ml-auto flex items-center gap-4">
            <div className="hidden items-center gap-3.5 text-xs lg:flex">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span className="size-1.5 rounded-full bg-info" />
                <b className="font-semibold text-foreground tabular-nums">
                  {session.data?.summary.snapshotChanges ?? 0}
                </b>{" "}
                snapshot updates
              </span>
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span className="size-1.5 rounded-full bg-success" />
                <b className="font-semibold text-foreground tabular-nums">
                  {session.data?.summary.total ?? 0}
                </b>{" "}
                tests completed
              </span>
              {runFailed ? (
                <span className="flex items-center gap-1.5 text-destructive">
                  <span className="size-1.5 rounded-full bg-destructive" />
                  <b className="font-semibold tabular-nums">
                    {session.data?.summary.failed ?? 0}
                  </b>{" "}
                  test failures
                </span>
              ) : null}
            </div>

            <Separator orientation="vertical" className="!h-6" />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() => setThemeMode(nextThemeMode(themeMode))}
                  aria-label={`Theme: ${themeMode}. Switch theme`}
                >
                  {themeMode === "system" ? (
                    <Monitor />
                  ) : themeMode === "dark" ? (
                    <Moon />
                  ) : (
                    <Sun />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent className="capitalize">
                Theme: {themeMode} ({resolvedTheme})
              </TooltipContent>
            </Tooltip>

            {active ? (
              <Button
                variant="outline"
                size="sm"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate()}
              >
                {cancel.isPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Square />
                )}
                {cancel.isPending ? "Cancelling…" : "Cancel"}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={
                  rerun.isPending || apply.isPending || decide.isPending
                }
                onClick={startRerun}
              >
                {rerun.isPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <RotateCcw />
                )}
                {rerun.isPending ? "Starting…" : "Rerun"}
              </Button>
            )}
          </div>
        </header>

        {active && session.data ? (
          <RunProgress session={session.data} progress={liveProgress} />
        ) : null}

        {/* Workspace */}
        <div className="workspace flex min-h-0 flex-1 overflow-hidden">
          {/* Left: change index */}
          <aside className="tree-panel flex w-80 shrink-0 flex-col border-r">
            <div className="flex flex-col gap-3 border-b p-3">
              <div className="flex items-center justify-between px-1">
                <span className="text-sm font-medium">
                  {grouping === "family" ? "Change families" : "Snapshot tests"}
                </span>
                <Badge variant="secondary" className="tabular-nums">
                  {list.length}
                </Badge>
              </div>
              <ToggleGroup
                type="single"
                value={grouping}
                onValueChange={(value) => {
                  if (!value) return;
                  setGrouping(value as "family" | "test");
                  setSelected(undefined);
                  setSelectedSourceEntryId(undefined);
                }}
                className="w-full"
              >
                <ToggleGroupItem value="family" className="flex-1">
                  Families
                </ToggleGroupItem>
                <ToggleGroupItem value="test" className="flex-1">
                  Tests
                </ToggleGroupItem>
              </ToggleGroup>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="h-9 pl-8"
                  placeholder={
                    grouping === "family"
                      ? "Filter change families…"
                      : "Filter tests and entries…"
                  }
                />
              </div>
              <ToggleGroup
                type="single"
                value={status ?? "all"}
                onValueChange={(value) =>
                  setStatus(value === "all" || !value ? undefined : value)
                }
                className="w-full"
              >
                {["all", "pending", "accepted", "rejected"].map((value) => (
                  <ToggleGroupItem
                    key={value}
                    value={value}
                    className="flex-1 capitalize"
                  >
                    {value}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>

            <div className="min-h-0 flex-1 overflow-auto" ref={scrollRef}>
              <div
                className="relative"
                style={{ height: virtualizer.getTotalSize() }}
              >
                {virtualizer.getVirtualItems().map((row) => {
                  const node = list[row.index];
                  if (!node) return null;
                  const isActive =
                    selected === node.id || node.entryId === selected;
                  return (
                    <button
                      type="button"
                      key={node.id}
                      className={`tree-row absolute inset-x-0 top-0 flex h-[60px] items-center gap-3 border-l-2 px-3 text-left transition-colors ${
                        isActive
                          ? "border-l-foreground bg-accent"
                          : "border-l-transparent hover:bg-accent/50"
                      }`}
                      style={{ transform: `translateY(${row.start}px)` }}
                      onClick={() => {
                        setSelected(node.id);
                        setSelectedSourceEntryId(undefined);
                      }}
                    >
                      <span
                        className={`size-2 shrink-0 rounded-full ${decisionTone(node.decision)}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {node.label}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {node.kind === "family"
                            ? `${node.childCount} occurrence${node.childCount === 1 ? "" : "s"} · ${node.testCount ?? 0} test${node.testCount === 1 ? "" : "s"}`
                            : `${node.changeType ? `${node.changeType} · ` : ""}${node.childCount} snapshot${node.childCount === 1 ? "" : "s"}`}
                        </span>
                      </span>
                      <span
                        className={`flex size-5 shrink-0 items-center justify-center rounded-md border font-mono text-xs ${changeTone(node.changeType)}`}
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

          {/* Right: diff + action bar */}
          <main className="diff-panel flex min-w-0 flex-1 flex-col overflow-hidden">
            {/* Title row */}
            <div className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                  {activeNode?.kind === "family"
                    ? "Exact change family"
                    : "Test review"}
                </div>
                <div className="truncate text-sm font-semibold">
                  {activeNode?.kind === "family"
                    ? activeNode.label
                    : (review.data?.test?.name ?? "Choose a snapshot change")}
                </div>
              </div>
              <ToggleGroup
                type="single"
                value={layout}
                onValueChange={(value) =>
                  value && setLayout(value as "split" | "unified")
                }
              >
                <ToggleGroupItem value="split" className="gap-1.5">
                  <Columns2 /> Split
                </ToggleGroupItem>
                <ToggleGroupItem value="unified" className="gap-1.5">
                  <Rows2 /> Unified
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            {/* Action bar (decisions) */}
            <div className="flex h-12 shrink-0 items-center gap-4 border-b bg-muted/40 px-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="hidden h-1.5 w-32 overflow-hidden rounded-full bg-border sm:flex">
                  <span
                    className="bg-success transition-[width]"
                    style={{ width: `${pct(totals.accepted)}%` }}
                  />
                  <span
                    className="bg-destructive transition-[width]"
                    style={{ width: `${pct(totals.rejected)}%` }}
                  />
                  <span
                    className="bg-warning transition-[width]"
                    style={{ width: `${pct(totals.pending)}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground">
                  <b className="font-semibold text-foreground tabular-nums">
                    {decided}
                  </b>{" "}
                  / {list.length} decided
                </span>
                <div className="hidden items-center gap-2.5 text-xs text-muted-foreground xl:flex">
                  <span className="flex items-center gap-1">
                    <span className="size-1.5 rounded-full bg-warning" />
                    {totals.pending}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="size-1.5 rounded-full bg-success" />
                    {totals.accepted}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="size-1.5 rounded-full bg-destructive" />
                    {totals.rejected}
                  </span>
                </div>
              </div>

              <div className="ml-auto flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!hasSelection || decide.isPending}
                  onClick={() =>
                    decide.mutate({
                      selectors: decisionSelectors,
                      decision: "rejected",
                      ...(nextReviewId ? { nextReviewId } : {}),
                    })
                  }
                >
                  <X /> Reject
                  <Kbd className="ml-0.5">R</Kbd>
                </Button>
                <Button
                  size="sm"
                  className="bg-success text-success-foreground hover:bg-success/90"
                  disabled={!hasSelection || decide.isPending}
                  onClick={() =>
                    decide.mutate({
                      selectors: decisionSelectors,
                      decision: "accepted",
                      ...(nextReviewId ? { nextReviewId } : {}),
                    })
                  }
                >
                  <Check />
                  {activeNode?.kind === "family"
                    ? `Accept ${activeNode.childCount}`
                    : "Accept"}
                  <Kbd className="ml-0.5 border-white/30 bg-white/15 text-current">
                    A
                  </Kbd>
                </Button>

                <Separator orientation="vertical" className="!h-6" />

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      disabled={active || apply.isPending || !totals.accepted}
                      onClick={() => apply.mutate()}
                    >
                      {apply.isPending
                        ? "Applying…"
                        : `Apply ${totals.accepted}`}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64">
                    {active
                      ? "Apply unlocks when the run finishes."
                      : "Only accepted hunks change repository files. Hash-protected · no Git operations."}
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>

            {/* Scrollable review content */}
            <div className="diff-scroll min-h-0 flex-1 overflow-auto bg-muted/20 p-4">
              {review.data ? (
                <div className="review-content flex w-full flex-col gap-4">
                  <section
                    className="flex flex-col gap-3"
                    aria-label="Snapshot chunks generated by this test"
                  >
                    <div className="flex items-center justify-between gap-3 px-1">
                      <div className="text-sm font-medium">
                        {activeNode?.kind === "family"
                          ? "Representative snapshot change"
                          : "Snapshot changes"}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {renderedEntries.length} chunk
                        {renderedEntries.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    {renderedEntries.map((item, index) => (
                      <article
                        className="snapshot-chunk overflow-hidden rounded-lg border bg-card"
                        key={item.entry.entryId}
                      >
                        <header className="flex items-center justify-between gap-3 border-b bg-muted/40 px-4 py-2.5">
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <span className="truncate text-sm font-medium">
                              {snapshotTitle(item.entry.context, index + 1)}
                            </span>
                            <code className="truncate font-mono text-xs text-muted-foreground">
                              {matcherInvocation(item.entry.context)}
                            </code>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {item.language === "json" ? (
                              <Badge variant="outline">JSON</Badge>
                            ) : null}
                            <span
                              className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${changeTone(item.entry.context.changeType)}`}
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

                  {activeNode?.kind === "family" ? (
                    <section className="family-summary flex items-center justify-between gap-4 rounded-lg border bg-card p-4">
                      <div className="min-w-0">
                        <div className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                          Compacted review
                        </div>
                        <div className="truncate text-sm font-semibold">
                          {activeNode.label}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Every occurrence has this complete set of exact
                          changes; unchanged context may differ.
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-5 text-center">
                        <div>
                          <div className="text-lg font-semibold tabular-nums">
                            {activeNode.childCount}
                          </div>
                          <div className="text-[10px] text-muted-foreground uppercase">
                            occurrences
                          </div>
                        </div>
                        <div>
                          <div className="text-lg font-semibold tabular-nums">
                            {activeNode.testCount ?? 0}
                          </div>
                          <div className="text-[10px] text-muted-foreground uppercase">
                            tests
                          </div>
                        </div>
                        <div>
                          <div className="text-lg font-semibold tabular-nums">
                            {activeNode.fileCount ?? 0}
                          </div>
                          <div className="text-[10px] text-muted-foreground uppercase">
                            files
                          </div>
                        </div>
                      </div>
                    </section>
                  ) : null}

                  <section className="source-preview overflow-hidden rounded-lg border bg-card">
                    <div className="flex flex-col items-stretch justify-between gap-3 border-b px-4 py-2.5 sm:flex-row sm:items-center">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">
                          {activeNode?.kind === "family"
                            ? "Affected test source"
                            : "Test source"}
                        </div>
                        <div className="truncate font-mono text-xs text-muted-foreground">
                          {displayedSource?.relativePath ??
                            selectedSourceOccurrence?.test.file}
                        </div>
                      </div>
                      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
                        {sourceOccurrences.length > 1 ? (
                          <fieldset
                            className="source-occurrence-selector m-0 flex min-w-0 items-center gap-1 border-0 p-0"
                            aria-label="Affected test source navigation"
                          >
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="size-8 shrink-0"
                              aria-label="Previous affected test"
                              disabled={sourceOccurrenceIndex <= 0}
                              onClick={() => {
                                setSelectedSourceEntryId(
                                  sourceOccurrences[sourceOccurrenceIndex - 1]
                                    ?.entryId,
                                );
                              }}
                            >
                              <ChevronLeft />
                            </Button>
                            <select
                              aria-label="Affected test source"
                              className="h-8 min-w-0 max-w-80 flex-1 rounded-md border bg-background px-2 text-xs shadow-xs sm:w-72"
                              value={selectedSourceOccurrence?.entryId ?? ""}
                              onChange={(event) =>
                                setSelectedSourceEntryId(event.target.value)
                              }
                            >
                              {sourceOccurrences.map((occurrence, index) => (
                                <option
                                  key={occurrence.entryId}
                                  value={occurrence.entryId}
                                >
                                  {index + 1}.{" "}
                                  {occurrence.test.name ??
                                    occurrence.test.file ??
                                    "Affected test"}
                                </option>
                              ))}
                            </select>
                            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                              {sourceOccurrenceIndex + 1}/
                              {sourceOccurrences.length}
                            </span>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="size-8 shrink-0"
                              aria-label="Next affected test"
                              disabled={
                                sourceOccurrenceIndex >=
                                sourceOccurrences.length - 1
                              }
                              onClick={() => {
                                setSelectedSourceEntryId(
                                  sourceOccurrences[sourceOccurrenceIndex + 1]
                                    ?.entryId,
                                );
                              }}
                            >
                              <ChevronRight />
                            </Button>
                          </fieldset>
                        ) : null}
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {[
                            linkedContextCount
                              ? `${linkedContextCount} context block${linkedContextCount === 1 ? "" : "s"}`
                              : null,
                            linkedHookCount
                              ? `${linkedHookCount} linked hook${linkedHookCount === 1 ? "" : "s"}`
                              : null,
                            "read only",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </div>
                    </div>
                    {activeNode?.kind === "family" &&
                    selectedSourceOccurrence?.test.name ? (
                      <div className="source-occurrence-title border-b px-4 py-2.5 text-sm leading-snug font-medium break-words">
                        {selectedSourceOccurrence.test.name}
                      </div>
                    ) : null}
                    <Suspense
                      fallback={
                        <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
                          <Code2 className="size-5" /> Coloring test source…
                        </div>
                      }
                    >
                      {displayedSource ? (
                        <SourceCodeView
                          source={displayedSource}
                          theme={resolvedTheme}
                        />
                      ) : occurrenceReview.isError ? (
                        <div className="flex min-h-32 items-center justify-center px-4 text-sm text-destructive">
                          Could not load this affected test source.
                        </div>
                      ) : (
                        <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
                          <LoaderCircle className="size-4 animate-spin" />
                          Loading affected test source…
                        </div>
                      )}
                    </Suspense>
                  </section>
                </div>
              ) : review.isError ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                  <FileCode2 className="size-9 text-muted-foreground" />
                  <div className="text-sm font-semibold">
                    Test review unavailable
                  </div>
                  <div className="max-w-80 text-xs text-muted-foreground">
                    {review.error.message}
                  </div>
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                  <FileCode2 className="size-9 text-muted-foreground" />
                  <div className="text-sm font-semibold">
                    {selected ? "Loading test review…" : "No snapshot selected"}
                  </div>
                  <div className="max-w-80 text-xs text-muted-foreground">
                    Select a change to see its exact test source and snapshot
                    diff.
                  </div>
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
