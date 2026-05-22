"use client";

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  Activity,
  ArrowDownUp,
  BarChart3,
  Bell,
  ExternalLink,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  Tags,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import type {
  BizAnalysisStatusDto,
  BizCorpusOverviewDto,
  BizIngestStatusDto,
  BizPostAnalysisState,
  BizPostDto,
  BizRealtimeEventDto,
  BizSearchResponseDto,
  BizSecuritySummaryDto,
  BizThreadDetailDto,
  BizThreadDto,
} from "@moneytree/shared";
import type { Socket } from "socket.io-client";

import { AppNavbar } from "@/components/navbar/presets/app";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RootStoreContext } from "@/context/rootStoreContext";
import useAuthGuard from "@/hooks/useAuthGuard";
import { fetchWithAuth } from "@/lib/utils";

const API_BASE =
  process.env.NEXT_PUBLIC_NEST_BACKEND_URL || "http://localhost:3000";
const READ_STATE_KEY = "moneytree.biz.readAtByThread";
const SCROLL_STATE_KEY = "moneytree.biz.scrollByThread";
type ReaderMode = "thread" | "feed" | "corpus";
type IngestProgress = {
  phase: string;
  message: string;
  startedAt: number;
  checked: number;
  planned: number;
  newPosts: number;
  errors: number;
};

export default function HomePage() {
  useAuthGuard();
  const rootStore = useContext(RootStoreContext);
  const token = rootStore.session?.access_token ?? "";

  const [threads, setThreads] = useState<BizThreadDto[]>([]);
  const [selectedThreadNo, setSelectedThreadNo] = useState<number | null>(null);
  const [threadDetail, setThreadDetail] = useState<BizThreadDetailDto | null>(
    null,
  );
  const [status, setStatus] = useState<BizIngestStatusDto | null>(null);
  const [analysisStatus, setAnalysisStatus] =
    useState<BizAnalysisStatusDto | null>(null);
  const [searchResponse, setSearchResponse] =
    useState<BizSearchResponseDto | null>(null);
  const [feedResponse, setFeedResponse] = useState<BizSearchResponseDto | null>(
    null,
  );
  const [corpusOverview, setCorpusOverview] =
    useState<BizCorpusOverviewDto | null>(null);
  const [corpusSearched, setCorpusSearched] = useState(false);
  const [securitySummary, setSecuritySummary] =
    useState<BizSecuritySummaryDto | null>(null);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [symbol, setSymbol] = useState("");
  const [sentiment, setSentiment] = useState("all");
  const [analysisState, setAnalysisState] = useState("all");
  const [loading, setLoading] = useState(false);
  const [ingestRunning, setIngestRunning] = useState(false);
  const [notice, setNotice] = useState("Waiting for live ingest events");
  const [progressEvents, setProgressEvents] = useState<string[]>([]);
  const [readerMode, setReaderMode] = useState<ReaderMode>("thread");
  const [readAtByThread, setReadAtByThread] = useState<Record<string, number>>(
    () => readLocalMap(READ_STATE_KEY),
  );
  const [selectedThreadReadAt, setSelectedThreadReadAt] = useState(0);
  const [ingestProgress, setIngestProgress] = useState<IngestProgress | null>(
    null,
  );
  const [progressNow, setProgressNow] = useState(() => Date.now());
  const readerScrollRef = useRef<HTMLDivElement | null>(null);

  const authFetch = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const response = await fetchWithAuth(token, `${API_BASE}${path}`, init);
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return response.json() as Promise<T>;
    },
    [token],
  );

  const loadStatus = useCallback(async () => {
    if (!token) return;
    const nextStatus =
      await authFetch<BizIngestStatusDto>("/biz/ingest/status");
    setStatus(nextStatus);
    const latestRun = nextStatus.latest_run;
    if (latestRun?.status === "running") {
      setIngestProgress((current) => ({
        phase: current?.phase ?? "running",
        message: current?.message ?? "Ingest running",
        startedAt:
          current?.startedAt ?? new Date(latestRun.started_at).getTime(),
        checked: latestRun.threads_checked,
        planned: latestRun.threads_planned,
        newPosts: latestRun.new_posts,
        errors: latestRun.error_count,
      }));
    }
    return nextStatus;
  }, [authFetch, token]);

  const loadAnalysisStatus = useCallback(async () => {
    if (!token) return;
    const nextStatus = await authFetch<BizAnalysisStatusDto>(
      "/biz/analysis/status",
    );
    setAnalysisStatus(nextStatus);
    return nextStatus;
  }, [authFetch, token]);

  const loadThreads = useCallback(async () => {
    if (!token) return;
    const nextThreads = await authFetch<BizThreadDto[]>("/biz/threads");
    setThreads(nextThreads);
    setSelectedThreadNo((current) => {
      if (current) return current;
      const firstThreadNo = nextThreads[0]?.thread_no ?? null;
      if (firstThreadNo) {
        setSelectedThreadReadAt(
          readLocalMap(READ_STATE_KEY)[String(firstThreadNo)] ?? 0,
        );
      }
      return firstThreadNo;
    });
  }, [authFetch, token]);

  const loadThread = useCallback(
    async (threadNo: number | null) => {
      if (!token || !threadNo) return;
      setThreadDetail(
        await authFetch<BizThreadDetailDto>(`/biz/threads/${threadNo}`),
      );
    },
    [authFetch, token],
  );

  const loadCorpusOverview = useCallback(async () => {
    if (!token) return;
    setCorpusOverview(
      await authFetch<BizCorpusOverviewDto>("/biz/corpus/overview"),
    );
  }, [authFetch, token]);

  const loadFeed = useCallback(async () => {
    if (!token) return;
    setFeedResponse(await authFetch<BizSearchResponseDto>("/biz/feed"));
  }, [authFetch, token]);

  const runCorpusSearch = useCallback(async () => {
    if (!token) return;
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (tag.trim()) params.set("tag", tag.trim());
    if (symbol.trim()) params.set("symbol", symbol.trim().toUpperCase());
    if (sentiment !== "all") params.set("sentiment", sentiment);
    if (analysisState !== "all") params.set("analysis_state", analysisState);
    params.set("limit", "80");
    setSearchResponse(
      await authFetch<BizSearchResponseDto>(
        `/biz/corpus/search?${params.toString()}`,
      ),
    );
    setCorpusSearched(true);
    setReaderMode("corpus");
  }, [analysisState, authFetch, query, sentiment, symbol, tag, token]);

  const loadSecuritySummary = useCallback(async () => {
    if (!token || !symbol.trim()) return;
    setSecuritySummary(
      await authFetch<BizSecuritySummaryDto>(
        `/biz/securities/${symbol.trim().toUpperCase()}/summary`,
      ),
    );
  }, [authFetch, symbol, token]);

  const addProgress = useCallback((message: string) => {
    setProgressEvents((current) => [message, ...current].slice(0, 12));
  }, []);

  const refreshAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      await Promise.all([
        loadStatus(),
        loadAnalysisStatus(),
        loadThreads(),
        loadFeed(),
        loadCorpusOverview(),
      ]);
      setNotice("Workspace refreshed");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Refresh failed");
    } finally {
      setLoading(false);
    }
  }, [
    loadAnalysisStatus,
    loadCorpusOverview,
    loadFeed,
    loadStatus,
    loadThreads,
    token,
  ]);

  const activeIngest =
    ingestRunning || status?.latest_run?.status === "running";

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refreshAll();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [refreshAll]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadThread(selectedThreadNo);
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [loadThread, selectedThreadNo]);

  useEffect(() => {
    if (!selectedThreadNo || readerMode !== "thread") return;
    const key = String(selectedThreadNo);
    const latestScrollMap = readLocalMap(SCROLL_STATE_KEY);
    const timeout = window.setTimeout(() => {
      if (readerScrollRef.current) {
        readerScrollRef.current.scrollTop = latestScrollMap[key] ?? 0;
      }
    }, 0);
    const scrollElement = readerScrollRef.current;

    return () => {
      window.clearTimeout(timeout);
      const scrollTop = scrollElement?.scrollTop ?? 0;
      writeLocalMap(SCROLL_STATE_KEY, {
        ...readLocalMap(SCROLL_STATE_KEY),
        [key]: scrollTop,
      });
      setReadAtByThread((current) => {
        const next = { ...current, [key]: Date.now() };
        writeLocalMap(READ_STATE_KEY, next);
        return next;
      });
    };
  }, [readerMode, selectedThreadNo]);

  useEffect(() => {
    if (!activeIngest) return;
    const interval = window.setInterval(() => setProgressNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [activeIngest]);

  useEffect(() => {
    if (
      !token ||
      (!analysisStatus?.running &&
        !analysisStatus?.queued &&
        !analysisStatus?.queued_triage)
    ) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadAnalysisStatus();
      void loadFeed();
      void loadCorpusOverview();
    }, 2000);

    return () => window.clearInterval(interval);
  }, [
    analysisStatus?.queued,
    analysisStatus?.queued_triage,
    analysisStatus?.running,
    loadAnalysisStatus,
    loadCorpusOverview,
    loadFeed,
    token,
  ]);

  useEffect(() => {
    const handler = (payload: BizRealtimeEventDto) => {
      const message = payload.message ?? payload.event;
      setNotice(
        payload.event === "new_posts"
          ? `${payload.new_posts ?? 0} new posts captured`
          : message,
      );
      if (
        payload.event === "ingest_started" ||
        payload.event === "ingest_progress"
      ) {
        setIngestRunning(true);
        setIngestProgress((current) => ({
          phase: payload.phase ?? "running",
          message,
          startedAt: current?.startedAt ?? Date.now(),
          checked: payload.threads_checked ?? 0,
          planned: payload.threads_planned ?? payload.catalog_threads ?? 0,
          newPosts: payload.new_posts ?? 0,
          errors: payload.error_count ?? 0,
        }));
        addProgress(
          `${new Date().toLocaleTimeString()} ${message} (${payload.threads_checked ?? 0}/${payload.threads_planned ?? payload.catalog_threads ?? "?"} threads, ${payload.new_posts ?? 0} new posts)`,
        );
      }
      if (
        payload.event === "ingest_completed" ||
        payload.event === "ingest_failed" ||
        payload.event === "new_posts" ||
        payload.event === "analysis_completed"
      ) {
        if (
          payload.event === "ingest_completed" ||
          payload.event === "ingest_failed"
        ) {
          setIngestRunning(false);
          setIngestProgress((current) =>
            current ? { ...current, phase: payload.event, message } : null,
          );
        }
        refreshAll();
      }
    };

    let attachedSocket: Socket | null = null;
    const attach = () => {
      const socket = rootStore.socket;
      if (!socket || socket === attachedSocket) return;
      attachedSocket?.off("biz_update", handler);
      attachedSocket = socket;
      attachedSocket.on("biz_update", handler);
      addProgress(`${new Date().toLocaleTimeString()} Live progress connected`);
    };

    attach();
    const interval = window.setInterval(attach, 1000);
    return () => {
      window.clearInterval(interval);
      attachedSocket?.off("biz_update", handler);
    };
  }, [addProgress, refreshAll, rootStore]);

  useEffect(() => {
    if (!token || !ingestRunning) return;

    const interval = window.setInterval(async () => {
      try {
        const nextStatus = await loadStatus();
        const latestRun = nextStatus?.latest_run;
        if (
          latestRun?.status === "completed" ||
          latestRun?.status === "failed"
        ) {
          setIngestRunning(false);
          setIngestProgress((current) =>
            current
              ? {
                  ...current,
                  phase: latestRun.status,
                  message: `Ingest ${latestRun.status}`,
                  checked: latestRun.threads_checked,
                  planned: latestRun.threads_planned,
                  newPosts: latestRun.new_posts,
                  errors: latestRun.error_count,
                }
              : null,
          );
          addProgress(
            `${new Date().toLocaleTimeString()} Ingest ${latestRun.status}: ${latestRun.new_posts} new posts, ${latestRun.error_count} errors`,
          );
          await Promise.all([loadThreads(), loadFeed(), loadCorpusOverview()]);
        }
      } catch (error) {
        setNotice(
          error instanceof Error ? error.message : "Status poll failed",
        );
      }
    }, 2000);

    return () => window.clearInterval(interval);
  }, [
    addProgress,
    ingestRunning,
    loadCorpusOverview,
    loadFeed,
    loadStatus,
    loadThreads,
    token,
  ]);

  const activePosts = useMemo(() => {
    if (readerMode === "corpus") {
      return searchResponse?.posts ?? [];
    }

    if (readerMode === "feed") {
      const posts = feedResponse?.posts ?? [];
      const feedQuery = query.trim().toLowerCase();
      if (!feedQuery) {
        return posts;
      }

      return posts.filter(
        (post) =>
          post.clean_text.toLowerCase().includes(feedQuery) ||
          post.subject?.toLowerCase().includes(feedQuery) ||
          post.thread_subject?.toLowerCase().includes(feedQuery) ||
          String(post.thread_no).includes(feedQuery),
      );
    }

    const posts = threadDetail?.posts ?? [];
    const threadQuery = query.trim().toLowerCase();
    if (!threadQuery) {
      return posts;
    }

    return posts.filter(
      (post) =>
        post.clean_text.toLowerCase().includes(threadQuery) ||
        post.subject?.toLowerCase().includes(threadQuery),
    );
  }, [
    feedResponse?.posts,
    query,
    readerMode,
    searchResponse?.posts,
    threadDetail?.posts,
  ]);

  async function triggerIngest() {
    if (!token) return;
    setLoading(true);
    setIngestRunning(true);
    setProgressEvents([]);
    setIngestProgress({
      phase: "starting",
      message: "Starting manual ingest",
      startedAt: Date.now(),
      checked: 0,
      planned: 0,
      newPosts: 0,
      errors: 0,
    });
    addProgress(`${new Date().toLocaleTimeString()} Starting manual ingest`);
    setNotice("Manual ingest starting");
    try {
      await authFetch("/biz/ingest/run", { method: "POST" });
      await loadStatus();
      setNotice("Manual ingest is running in the background");
      addProgress(
        `${new Date().toLocaleTimeString()} Request accepted; waiting for progress`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Ingest failed");
      setIngestRunning(false);
    } finally {
      setLoading(false);
    }
  }

  async function controlAnalysis(action: "start" | "pause" | "resume") {
    if (!token) return;
    try {
      const nextStatus = await authFetch<BizAnalysisStatusDto>(
        `/biz/analysis/${action}`,
        { method: "POST" },
      );
      setAnalysisStatus(nextStatus);
      setNotice(`Analysis ${action} requested`);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : `Analysis ${action} failed`,
      );
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950">
      <AppNavbar className="border-b border-zinc-200 bg-white/95 text-zinc-950" />
      <main className="mx-auto grid max-w-[1680px] gap-4 px-4 pb-8 pt-24">
        <section className="grid gap-3 border-b border-zinc-200 pb-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">
              Financial Signal Workspace
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              Source: 4chan /biz/. Analysis labels are machine-generated and are
              not investment advice.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={readerMode === "thread" ? "default" : "outline"}
              size="sm"
              onClick={() => setReaderMode("thread")}
            >
              Thread
            </Button>
            <Button
              type="button"
              variant={readerMode === "feed" ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setReaderMode("feed");
                void loadFeed();
              }}
            >
              Feed
            </Button>
            <Button
              type="button"
              variant={readerMode === "corpus" ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setReaderMode("corpus");
                setCorpusSearched(false);
                void loadCorpusOverview();
              }}
            >
              Corpus
            </Button>
            <StatusPill status={status} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={refreshAll}
              disabled={loading || activeIngest}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Refresh
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={triggerIngest}
              disabled={loading || activeIngest}
            >
              {activeIngest ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowDownUp className="h-4 w-4" />
              )}
              {activeIngest ? "Ingesting" : "Run Ingest"}
            </Button>
          </div>
        </section>

        <section className="grid gap-3 lg:grid-cols-[360px_minmax(0,1fr)_420px]">
          <aside className="min-h-[72vh] border border-zinc-200 bg-white">
            <PanelHeader
              icon={<Activity className="h-4 w-4" />}
              title="Threads"
            />
            <div className="max-h-[72vh] overflow-y-auto">
              {threads.map((thread) => (
                <button
                  key={thread.thread_no}
                  type="button"
                  onClick={() => {
                    setReaderMode("thread");
                    setSelectedThreadReadAt(
                      readLocalMap(READ_STATE_KEY)[String(thread.thread_no)] ??
                        0,
                    );
                    setSelectedThreadNo(thread.thread_no);
                    setSearchResponse(null);
                  }}
                  className={`block w-full border-b border-zinc-100 px-3 py-3 text-left hover:bg-zinc-50 ${
                    selectedThreadNo === thread.thread_no ? "bg-emerald-50" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-zinc-500">
                      No. {thread.thread_no}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {thread.post_count ?? 0} posts
                    </span>
                  </div>
                  {isThreadUnread(thread, readAtByThread) && (
                    <Badge className="mt-2 bg-amber-500 text-white">new</Badge>
                  )}
                  <div className="mt-1 line-clamp-2 text-sm font-medium">
                    {thread.subject || "Untitled thread"}
                  </div>
                  <div className="mt-2 flex gap-1">
                    <Badge variant={thread.active ? "secondary" : "outline"}>
                      {thread.active ? "active" : "inactive"}
                    </Badge>
                    {thread.sticky && <Badge variant="secondary">sticky</Badge>}
                    {thread.closed && <Badge variant="outline">closed</Badge>}
                    {thread.archived && (
                      <Badge variant="outline">archived</Badge>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </aside>

          <section className="min-h-[72vh] border border-zinc-200 bg-white">
            <PanelHeader
              icon={
                readerMode === "corpus" ? (
                  <BarChart3 className="h-4 w-4" />
                ) : readerMode === "feed" ? (
                  <Activity className="h-4 w-4" />
                ) : (
                  <Search className="h-4 w-4" />
                )
              }
              title={
                readerMode === "corpus"
                  ? corpusSearched
                    ? `Corpus Results (${searchResponse?.total ?? 0})`
                    : "Corpus Overview"
                  : readerMode === "feed"
                    ? `Feed (${activePosts.length})`
                    : `Thread ${selectedThreadNo ?? ""}`
              }
              action={
                readerMode === "thread" && threadDetail?.thread.source_url ? (
                  <a
                    className="inline-flex items-center gap-1 text-xs text-zinc-600 hover:text-zinc-950"
                    href={threadDetail.thread.source_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Source <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null
              }
            />
            {readerMode === "thread" ? (
              <div className="grid gap-2 border-b border-zinc-200 p-3 md:grid-cols-[1fr_auto]">
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter this thread"
                />
                <Button type="button" variant="outline">
                  <Filter className="h-4 w-4" />
                  Local Filter
                </Button>
              </div>
            ) : readerMode === "feed" ? (
              <div className="grid gap-2 border-b border-zinc-200 p-3 md:grid-cols-[1fr_auto]">
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter feed text, thread title, or thread number"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => loadFeed()}
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh Feed
                </Button>
              </div>
            ) : (
              <div className="grid gap-2 border-b border-zinc-200 p-3 md:grid-cols-[1fr_130px_120px_130px_150px_auto]">
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search corpus text, tags, symbols"
                />
                <Input
                  value={tag}
                  onChange={(event) => setTag(event.target.value)}
                  placeholder="Tag"
                />
                <Input
                  value={symbol}
                  onChange={(event) => setSymbol(event.target.value)}
                  placeholder="Symbol"
                />
                <Select value={sentiment} onValueChange={setSentiment}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All stance</SelectItem>
                    <SelectItem value="bullish">Bullish</SelectItem>
                    <SelectItem value="bearish">Bearish</SelectItem>
                    <SelectItem value="neutral">Neutral</SelectItem>
                    <SelectItem value="mixed">Mixed</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={analysisState} onValueChange={setAnalysisState}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All analysis</SelectItem>
                    <SelectItem value="raw">Raw</SelectItem>
                    <SelectItem value="triaged">Triaged</SelectItem>
                    <SelectItem value="ai_queued">AI queued</SelectItem>
                    <SelectItem value="ai_analyzed">AI analyzed</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                    <SelectItem value="stale">Stale</SelectItem>
                  </SelectContent>
                </Select>
                <Button type="button" onClick={() => runCorpusSearch()}>
                  <Search className="h-4 w-4" />
                  Search
                </Button>
              </div>
            )}
            {readerMode === "corpus" && corpusSearched && (
              <div className="border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                Showing corpus results ranked by text/tag/symbol match,
                confidence, and recency.
              </div>
            )}
            {readerMode === "feed" && (
              <div className="border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                Showing latest captured posts across all threads, newest first.
              </div>
            )}
            {readerMode === "corpus" && !corpusSearched ? (
              <CorpusOverview overview={corpusOverview} />
            ) : (
              <PostList
                posts={activePosts}
                readAt={readerMode === "thread" ? selectedThreadReadAt : 0}
                scrollRef={readerScrollRef}
                showThreadContext={readerMode === "feed"}
                onThreadClick={(threadNo) => {
                  setReaderMode("thread");
                  setSelectedThreadReadAt(
                    readLocalMap(READ_STATE_KEY)[String(threadNo)] ?? 0,
                  );
                  setSelectedThreadNo(threadNo);
                }}
              />
            )}
          </section>

          <aside className="grid min-h-[72vh] gap-3">
            <section className="border border-zinc-200 bg-white">
              <PanelHeader
                icon={<TrendingUp className="h-4 w-4" />}
                title="Security Summary"
              />
              <div className="grid gap-3 p-3">
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <Input
                    value={symbol}
                    onChange={(event) => setSymbol(event.target.value)}
                    placeholder="Ticker or crypto symbol"
                  />
                  <Button type="button" onClick={loadSecuritySummary}>
                    Analyze
                  </Button>
                </div>
                {securitySummary ? (
                  <SecuritySummary summary={securitySummary} />
                ) : (
                  <p className="text-sm text-zinc-500">
                    Enter a symbol to collect related /biz/ posts and summarize
                    the bullish and bearish case.
                  </p>
                )}
              </div>
            </section>

            <section className="border border-zinc-200 bg-white">
              <PanelHeader icon={<Bell className="h-4 w-4" />} title="Ingest" />
              <div className="grid gap-3 p-3 text-sm">
                <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                  {notice}
                </div>
                {activeIngest && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-950">
                    Ingest is active. First runs can take several minutes
                    because the crawler respects the 1 request/second source API
                    limit.
                  </div>
                )}
                {ingestProgress && (
                  <IngestProgressBar
                    now={progressNow}
                    progress={ingestProgress}
                  />
                )}
                <Metric label="Threads" value={status?.total_threads ?? 0} />
                <Metric
                  label="Scraped posts"
                  value={status?.total_posts ?? 0}
                />
                <Metric
                  label="Triage queue"
                  value={status?.queued_triage_jobs ?? 0}
                />
                <Metric
                  label="Triaged posts"
                  value={status?.completed_triage_jobs ?? 0}
                />
                <Metric
                  label="Latest post"
                  value={
                    status?.latest_post_at
                      ? new Date(status.latest_post_at).toLocaleString()
                      : "none"
                  }
                />
                <div className="rounded-md border border-zinc-200 bg-white p-3">
                  <div className="mb-2 text-[11px] uppercase text-zinc-500">
                    Progress Log
                  </div>
                  <div className="grid max-h-48 gap-2 overflow-y-auto font-mono text-xs text-zinc-700">
                    {progressEvents.length > 0 ? (
                      progressEvents.map((event, index) => (
                        <div key={`${event}-${index}`}>{event}</div>
                      ))
                    ) : (
                      <div>No progress events yet.</div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className="border border-zinc-200 bg-white">
              <PanelHeader
                icon={<BarChart3 className="h-4 w-4" />}
                title="Analysis"
              />
              <div className="grid gap-3 p-3 text-sm">
                <AnalysisProgressBar status={analysisStatus} />
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => controlAnalysis("start")}
                    disabled={
                      !analysisStatus?.ai_enabled || analysisStatus?.running
                    }
                  >
                    Start
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => controlAnalysis("pause")}
                    disabled={analysisStatus?.paused}
                  >
                    Pause
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => controlAnalysis("resume")}
                    disabled={!analysisStatus?.paused}
                  >
                    Resume
                  </Button>
                </div>
                <Metric
                  label="AI status"
                  value={
                    analysisStatus?.ai_enabled
                      ? analysisStatus.current_message
                      : "missing key"
                  }
                />
                <Metric
                  label="AI candidate posts"
                  value={analysisStatus?.analyzable_posts ?? 0}
                />
                <Metric
                  label="AI analyzed posts"
                  value={analysisStatus?.analyzed_posts ?? 0}
                />
                <Metric
                  label="Queued triage"
                  value={analysisStatus?.queued_triage ?? 0}
                />
                <Metric
                  label="Running triage"
                  value={analysisStatus?.running_triage_jobs ?? 0}
                />
                <Metric label="Queued AI" value={analysisStatus?.queued ?? 0} />
                <Metric
                  label="Running AI"
                  value={analysisStatus?.running_jobs ?? 0}
                />
                <Metric
                  label="AI backlog"
                  value={
                    (analysisStatus?.queued ?? 0) +
                    (analysisStatus?.running_jobs ?? 0)
                  }
                />
                <Metric
                  label="Failed triage"
                  value={analysisStatus?.failed_triage ?? 0}
                />
                <Metric label="Failed AI" value={analysisStatus?.failed ?? 0} />
                <Metric
                  label="AI concurrency"
                  value={analysisStatus?.ai_concurrency ?? 0}
                />
                <Metric
                  label="Triage concurrency"
                  value={analysisStatus?.triage_concurrency ?? 0}
                />
              </div>
            </section>
          </aside>
        </section>
      </main>
    </div>
  );
}

function PanelHeader({
  icon,
  title,
  action,
}: {
  icon: ReactNode;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-11 items-center justify-between border-b border-zinc-200 px-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </div>
      {action}
    </div>
  );
}

function CorpusOverview({
  overview,
}: {
  overview: BizCorpusOverviewDto | null;
}) {
  if (!overview) {
    return <div className="p-6 text-sm text-zinc-500">Loading corpus...</div>;
  }

  return (
    <div className="grid max-h-[63vh] gap-4 overflow-y-auto p-4">
      <div className="grid gap-2 md:grid-cols-4">
        <Metric label="Threads" value={overview.total_threads} />
        <Metric label="Posts" value={overview.total_posts} />
        <Metric
          label="AI analyzed"
          value={overview.analysis_counts.ai_analyzed ?? 0}
        />
        <Metric
          label="AI queued"
          value={overview.analysis_counts.ai_queued ?? 0}
        />
      </div>

      <section className="grid gap-3 md:grid-cols-2">
        <TermCloud
          icon={<TrendingUp className="h-4 w-4" />}
          title="Top Securities"
          terms={overview.top_securities}
        />
        <TermCloud
          icon={<Tags className="h-4 w-4" />}
          title="Top Tags"
          terms={overview.top_tags}
        />
      </section>

      <TermCloud
        icon={<BarChart3 className="h-4 w-4" />}
        title="Term Heatmap"
        terms={overview.heatmap_terms}
        heat
      />

      <section>
        <div className="mb-2 text-sm font-semibold">Recent Captured Posts</div>
        <div className="grid gap-2">
          {overview.recent_posts.slice(0, 8).map((post) => (
            <div key={post.id} className="border border-zinc-200 bg-white p-3">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                <span className="font-mono">No. {post.post_no}</span>
                <AnalysisBadge state={post.analysis_state} />
                <span>{new Date(post.posted_at).toLocaleString()}</span>
              </div>
              <p className="line-clamp-3 text-sm text-zinc-800">
                {post.clean_text || "[no text]"}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function TermCloud({
  icon,
  title,
  terms,
  heat = false,
}: {
  icon: ReactNode;
  title: string;
  terms: Array<{ value: string; count: number; weight: number }>;
  heat?: boolean;
}) {
  const max = Math.max(...terms.map((term) => term.weight), 1);

  return (
    <section className="border border-zinc-200 bg-zinc-50 p-3">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </div>
      <div className="flex flex-wrap gap-2">
        {terms.length > 0 ? (
          terms.map((term) => {
            const intensity = Math.max(0.18, term.weight / max);
            return (
              <span
                key={term.value}
                className="rounded-md border border-zinc-200 px-2 py-1 text-xs"
                style={
                  heat
                    ? {
                        backgroundColor: `rgba(16, 185, 129, ${intensity})`,
                      }
                    : undefined
                }
              >
                {term.value} <span className="text-zinc-500">{term.count}</span>
              </span>
            );
          })
        ) : (
          <span className="text-sm text-zinc-500">No terms yet.</span>
        )}
      </div>
    </section>
  );
}

function PostList({
  posts,
  readAt,
  scrollRef,
  showThreadContext = false,
  onThreadClick,
}: {
  posts: BizPostDto[];
  readAt: number;
  scrollRef: RefObject<HTMLDivElement | null>;
  showThreadContext?: boolean;
  onThreadClick?: (threadNo: number) => void;
}) {
  if (posts.length === 0) {
    return (
      <div className="p-6 text-sm text-zinc-500">No posts loaded yet.</div>
    );
  }

  return (
    <div ref={scrollRef} className="max-h-[63vh] overflow-y-auto">
      {posts.map((post) => (
        <article
          key={post.id}
          className={`border-b p-4 ${
            isPostUnread(post, readAt)
              ? "border-amber-200 bg-amber-50/70"
              : "border-zinc-100"
          }`}
        >
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span className="font-mono">No. {post.post_no}</span>
            {showThreadContext && (
              <button
                type="button"
                onClick={() => onThreadClick?.(post.thread_no)}
                className="font-mono text-emerald-700 hover:text-emerald-900"
              >
                Thread {post.thread_no}
              </button>
            )}
            <span>{new Date(post.posted_at).toLocaleString()}</span>
            <AnalysisBadge state={post.analysis_state} />
            {isPostUnread(post, readAt) && (
              <Badge className="bg-amber-500 text-white">new</Badge>
            )}
            <a
              href={post.source_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:text-zinc-950"
            >
              source <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          {showThreadContext && (
            <div className="mt-2 border-l-2 border-zinc-200 pl-3 text-xs text-zinc-600">
              {post.thread_subject || "Untitled thread"}
            </div>
          )}
          {post.subject && (
            <h2 className="mt-2 text-base font-semibold">{post.subject}</h2>
          )}
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-800">
            {post.clean_text || "[no text]"}
          </p>
          <div className="mt-3 flex flex-wrap gap-1">
            {post.security_mentions.map((mention) => (
              <Badge
                key={mention.id}
                variant={
                  mention.stance === "bearish" ? "destructive" : "secondary"
                }
              >
                {mention.symbol} {mention.stance}
              </Badge>
            ))}
            {post.tags.slice(0, 8).map((tag) => (
              <Badge key={tag.id} variant="outline">
                {tag.tag_type}:{tag.value}
              </Badge>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function AnalysisBadge({ state }: { state: BizPostAnalysisState }) {
  const variant =
    state === "failed" || state === "stale" ? "destructive" : "outline";
  return <Badge variant={variant}>{state.replace("_", " ")}</Badge>;
}

function SecuritySummary({ summary }: { summary: BizSecuritySummaryDto }) {
  return (
    <div className="grid gap-3 text-sm">
      <div className="grid grid-cols-4 gap-2">
        <Metric label="Mentions" value={summary.total_mentions} />
        <Metric label="Bull" value={summary.bullish_count} />
        <Metric label="Bear" value={summary.bearish_count} />
        <Metric label="Mixed" value={summary.mixed_count} />
      </div>
      <p className="rounded-md border border-zinc-200 bg-zinc-50 p-3 leading-6">
        {summary.summary}
      </p>
      <Evidence
        icon={<TrendingUp className="h-4 w-4 text-emerald-600" />}
        title="Bullish"
        points={summary.bullish_points}
      />
      <Evidence
        icon={<TrendingDown className="h-4 w-4 text-red-600" />}
        title="Bearish"
        points={summary.bearish_points}
      />
    </div>
  );
}

function Evidence({
  icon,
  title,
  points,
}: {
  icon: ReactNode;
  title: string;
  points: string[];
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 font-medium">
        {icon}
        {title}
      </div>
      <div className="grid gap-2">
        {(points.length ? points : ["No strong evidence captured yet."]).map(
          (point, index) => (
            <p
              key={`${title}-${index}`}
              className="border-l-2 border-zinc-300 pl-3"
            >
              {point}
            </p>
          ),
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white px-3 py-2">
      <div className="text-[11px] uppercase text-zinc-500">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold">{value}</div>
    </div>
  );
}

function IngestProgressBar({
  now,
  progress,
}: {
  now: number;
  progress: IngestProgress;
}) {
  const percent =
    progress.planned > 0
      ? Math.min(100, Math.round((progress.checked / progress.planned) * 100))
      : 0;
  const remaining = Math.max(progress.planned - progress.checked, 0);
  const etaSeconds = remaining > 0 ? Math.ceil((remaining * 1100) / 1000) : 0;
  const elapsedSeconds = Math.max(
    0,
    Math.round((now - progress.startedAt) / 1000),
  );

  return (
    <div className="rounded-md border border-zinc-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-zinc-800">{progress.message}</span>
        <span className="font-mono text-zinc-500">{percent}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-zinc-600">
        <span>
          {progress.checked}/{progress.planned || "?"} threads checked
        </span>
        <span className="text-right">
          ETA {etaSeconds > 0 ? `${etaSeconds}s` : "finishing"} · elapsed{" "}
          {elapsedSeconds}s
        </span>
        <span>{progress.newPosts} new posts</span>
        <span className="text-right">{progress.errors} errors</span>
      </div>
    </div>
  );
}

function AnalysisProgressBar({
  status,
}: {
  status: BizAnalysisStatusDto | null;
}) {
  const triageQueued = status?.queued_triage ?? 0;
  const triageRunning = status?.running_triage_jobs ?? 0;
  const aiQueued = status?.queued ?? 0;
  const aiRunning = status?.running_jobs ?? 0;
  const failed = (status?.failed_triage ?? 0) + (status?.failed ?? 0);
  const complete = status?.analyzed_posts ?? 0;
  const remaining = triageQueued + triageRunning + aiQueued + aiRunning;
  const total = complete + remaining + failed;
  const percent =
    total > 0
      ? Math.round((complete / total) * 100)
      : (status?.progress_percent ?? 0);

  return (
    <div className="rounded-md border border-zinc-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-zinc-800">
          {status?.current_message ?? "Analysis status unavailable"}
        </span>
        <span className="font-mono text-zinc-500">{percent}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
        <div
          className="h-full rounded-full bg-sky-500 transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-zinc-600">
        <span>
          {complete}/{total || "?"} posts analyzed
        </span>
        <span className="text-right">
          {status?.paused ? "paused" : status?.running ? "running" : "idle"}
        </span>
        <span>{triageQueued + triageRunning} triage backlog</span>
        <span className="text-right">{aiQueued + aiRunning} AI backlog</span>
        <span>{failed} failed</span>
        <span className="text-right">
          {status?.ai_concurrency ?? status?.concurrency ?? 0} AI workers
        </span>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: BizIngestStatusDto | null }) {
  const run = status?.latest_run;
  const label = run
    ? `${run.status} ${run.finished_at ? new Date(run.finished_at).toLocaleTimeString() : ""}`
    : "No ingest run";

  return (
    <div className="inline-flex h-9 items-center gap-2 border border-zinc-200 bg-white px-3 text-sm">
      <span
        className={`h-2 w-2 rounded-full ${
          run?.status === "failed"
            ? "bg-red-500"
            : run?.status === "running"
              ? "bg-amber-500"
              : "bg-emerald-500"
        }`}
      />
      {label}
    </div>
  );
}

function isThreadUnread(
  thread: BizThreadDto,
  readAtByThread: Record<string, number>,
) {
  const latest = thread.latest_post_at
    ? new Date(thread.latest_post_at).getTime()
    : 0;
  return latest > (readAtByThread[String(thread.thread_no)] ?? 0);
}

function isPostUnread(post: BizPostDto, readAt: number) {
  return new Date(post.first_seen_at).getTime() > readAt;
}

function readLocalMap(key: string): Record<string, number> {
  if (typeof window === "undefined") return {};

  try {
    const value = window.localStorage.getItem(key);
    if (!value) return {};
    return JSON.parse(value) as Record<string, number>;
  } catch {
    return {};
  }
}

function writeLocalMap(key: string, value: Record<string, number>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}
