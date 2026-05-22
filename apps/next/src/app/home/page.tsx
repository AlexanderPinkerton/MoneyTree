"use client";

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  Activity,
  ArrowDownUp,
  Ban,
  BarChart3,
  Bell,
  ExternalLink,
  Filter,
  Loader2,
  Maximize2,
  Minimize2,
  RefreshCw,
  Search,
  Tags,
  TrendingDown,
  TrendingUp,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type {
  BizAnalysisStatusDto,
  BizAttachmentDto,
  BizCorpusOverviewDto,
  BizIngestStatusDto,
  BizPostAnalysisState,
  BizPostDto,
  BizRealtimeEventDto,
  BizSearchResponseDto,
  BizSecuritySummaryDto,
  BizTermBlacklistEntryDto,
  BizThreadDetailDto,
  BizThreadDto,
} from "@moneytree/shared";
import type { Socket } from "socket.io-client";

import { AppNavbar } from "@/components/navbar/presets/app";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
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
const LEGACY_READ_THREAD_STATE_KEY = "moneytree.biz.readAtByThread";
const READ_POST_STATE_KEY = "moneytree.biz.readPostNos";
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
type ImagePreview = {
  attachment: BizAttachmentDto;
  title: string;
};
type CorpusSearchOverrides = Partial<{
  query: string;
  tag: string;
  symbol: string;
  sentiment: string;
  analysisState: string;
}>;

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
  const [readPostNos, setReadPostNos] = useState<Record<string, number>>(() =>
    readLocalMap(READ_POST_STATE_KEY),
  );
  const [ingestProgress, setIngestProgress] = useState<IngestProgress | null>(
    null,
  );
  const [progressNow, setProgressNow] = useState(() => Date.now());
  const [imagePreview, setImagePreview] = useState<ImagePreview | null>(null);
  const [imageZoom, setImageZoom] = useState(1);
  const [imageFullscreen, setImageFullscreen] = useState(false);
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
    setReadPostNos((current) => migrateLegacyThreadReads(nextThreads, current));
    setSelectedThreadNo((current) => {
      if (current) return current;
      const firstThreadNo = nextThreads[0]?.thread_no ?? null;
      return firstThreadNo;
    });
  }, [authFetch, token]);

  const loadThread = useCallback(
    async (threadNo: number | null) => {
      if (!token || !threadNo) return;
      setThreadDetail(null);
      const nextThread = await authFetch<BizThreadDetailDto>(
        `/biz/threads/${threadNo}`,
      );
      setThreadDetail(nextThread);
    },
    [authFetch, token],
  );

  const loadCorpusOverview = useCallback(async () => {
    if (!token) return;
    setCorpusOverview(
      await authFetch<BizCorpusOverviewDto>("/biz/corpus/overview"),
    );
  }, [authFetch, token]);

  const blacklistCorpusTerm = useCallback(
    async (term: string) => {
      if (!token || !term.trim()) return;
      await authFetch<BizTermBlacklistEntryDto[]>(
        "/biz/corpus/term-blacklist",
        {
          method: "POST",
          body: JSON.stringify({ term: term.trim() }),
        },
      );
      setNotice(`Blacklisted "${term.trim()}"`);
      await loadCorpusOverview();
    },
    [authFetch, loadCorpusOverview, token],
  );

  const removeCorpusBlacklistTerm = useCallback(
    async (term: string) => {
      if (!token || !term.trim()) return;
      await authFetch<BizTermBlacklistEntryDto[]>(
        "/biz/corpus/term-blacklist/remove",
        {
          method: "POST",
          body: JSON.stringify({ term: term.trim() }),
        },
      );
      setNotice(`Removed "${term.trim()}" from blacklist`);
      await loadCorpusOverview();
    },
    [authFetch, loadCorpusOverview, token],
  );

  const loadFeed = useCallback(async () => {
    if (!token) return;
    setFeedResponse(await authFetch<BizSearchResponseDto>("/biz/feed"));
  }, [authFetch, token]);

  const runCorpusSearch = useCallback(
    async (overrides: CorpusSearchOverrides = {}) => {
      if (!token) return;
      const nextQuery =
        "query" in overrides ? String(overrides.query ?? "") : query;
      const nextTag = "tag" in overrides ? String(overrides.tag ?? "") : tag;
      const nextSymbol =
        "symbol" in overrides ? String(overrides.symbol ?? "") : symbol;
      const nextSentiment =
        "sentiment" in overrides
          ? String(overrides.sentiment ?? "all")
          : sentiment;
      const nextAnalysisState =
        "analysisState" in overrides
          ? String(overrides.analysisState ?? "all")
          : analysisState;

      if ("query" in overrides) setQuery(nextQuery);
      if ("tag" in overrides) setTag(nextTag);
      if ("symbol" in overrides) setSymbol(nextSymbol);
      if ("sentiment" in overrides) setSentiment(nextSentiment);
      if ("analysisState" in overrides) setAnalysisState(nextAnalysisState);

      const params = new URLSearchParams();
      if (nextQuery.trim()) params.set("q", nextQuery.trim());
      if (nextTag.trim()) params.set("tag", nextTag.trim());
      if (nextSymbol.trim())
        params.set("symbol", nextSymbol.trim().toUpperCase());
      if (nextSentiment !== "all") params.set("sentiment", nextSentiment);
      if (nextAnalysisState !== "all")
        params.set("analysis_state", nextAnalysisState);
      params.set("limit", "80");
      setSearchResponse(
        await authFetch<BizSearchResponseDto>(
          `/biz/corpus/search?${params.toString()}`,
        ),
      );
      setCorpusSearched(true);
      setReaderMode("corpus");
    },
    [analysisState, authFetch, query, sentiment, symbol, tag, token],
  );

  const loadSecuritySummary = useCallback(async () => {
    if (!token || !symbol.trim()) return;
    setSecuritySummary(
      await authFetch<BizSecuritySummaryDto>(
        `/biz/securities/${symbol.trim().toUpperCase()}/summary`,
      ),
    );
  }, [authFetch, symbol, token]);

  const openImagePreview = useCallback(
    (attachment: BizAttachmentDto, title: string) => {
      setImageZoom(1);
      setImageFullscreen(false);
      setImagePreview({ attachment, title });
    },
    [],
  );

  const markPostRead = useCallback((post: BizPostDto) => {
    const key = String(post.post_no);
    setReadPostNos((current) => {
      if (current[key]) return current;
      const next = { ...current, [key]: Date.now() };
      writeLocalMap(READ_POST_STATE_KEY, next);
      return next;
    });
  }, []);

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
    const scrollElement = readerScrollRef.current;

    return () => {
      const scrollTop = scrollElement?.scrollTop ?? 0;
      writeLocalMap(SCROLL_STATE_KEY, {
        ...readLocalMap(SCROLL_STATE_KEY),
        [key]: scrollTop,
      });
    };
  }, [readerMode, selectedThreadNo]);

  useEffect(() => {
    if (
      !selectedThreadNo ||
      readerMode !== "thread" ||
      threadDetail?.thread.thread_no !== selectedThreadNo
    ) {
      return;
    }

    const key = String(selectedThreadNo);
    const animationFrame = window.requestAnimationFrame(() => {
      if (readerScrollRef.current) {
        readerScrollRef.current.scrollTop =
          readLocalMap(SCROLL_STATE_KEY)[key] ?? 0;
      }
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [
    readerMode,
    selectedThreadNo,
    threadDetail?.posts.length,
    threadDetail?.thread.thread_no,
  ]);

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
    <div className="biz-workspace dark min-h-screen bg-[#050505] text-zinc-100">
      <AppNavbar className="border-b border-zinc-800 bg-[#050505]/95 text-zinc-100" />
      <main className="mx-auto grid max-w-[1680px] gap-4 px-4 pb-8 pt-24">
        <section className="grid gap-3 border-b border-zinc-800 pb-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">
              Financial Signal Workspace
            </h1>
            <p className="mt-1 text-sm text-zinc-400">
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
          <aside className="min-h-[72vh] border border-zinc-800 bg-[#0a0a0a]">
            <PanelHeader
              icon={<Activity className="h-4 w-4" />}
              title="Threads"
            />
            <div className="max-h-[72vh] overflow-y-auto">
              {threads.map((thread) => (
                <div
                  key={thread.thread_no}
                  onClick={() => {
                    setReaderMode("thread");
                    setSelectedThreadNo(thread.thread_no);
                    setSearchResponse(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    setReaderMode("thread");
                    setSelectedThreadNo(thread.thread_no);
                    setSearchResponse(null);
                  }}
                  role="button"
                  tabIndex={0}
                  className={`block w-full cursor-pointer border-b border-zinc-800/80 px-3 py-3 text-left hover:bg-[#121212] ${
                    selectedThreadNo === thread.thread_no
                      ? "bg-zinc-800/70"
                      : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-zinc-400">
                      No. {thread.thread_no}
                    </span>
                    <span className="text-xs text-zinc-400">
                      {thread.post_count ?? 0} posts
                    </span>
                  </div>
                  {isThreadUnread(thread, readPostNos) && (
                    <Badge className="mt-2 bg-amber-500 text-black">new</Badge>
                  )}
                  {thread.active && thread.attachment && (
                    <AttachmentPreview
                      attachment={thread.attachment}
                      compact
                      onOpen={(attachment) =>
                        openImagePreview(
                          attachment,
                          `Thread ${thread.thread_no}`,
                        )
                      }
                    />
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
                </div>
              ))}
            </div>
          </aside>

          <section className="min-h-[72vh] border border-zinc-800 bg-[#0a0a0a]">
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
                    className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-100"
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
              <div className="grid gap-2 border-b border-zinc-800 p-3 md:grid-cols-[1fr_auto]">
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
              <div className="grid gap-2 border-b border-zinc-800 p-3 md:grid-cols-[1fr_auto]">
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
              <div className="grid gap-2 border-b border-zinc-800 p-3 md:grid-cols-[1fr_130px_120px_130px_150px_auto]">
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
                  <SelectContent className="border-zinc-800 bg-[#0a0a0a] text-zinc-100">
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
                  <SelectContent className="border-zinc-800 bg-[#0a0a0a] text-zinc-100">
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
              <div className="border-b border-zinc-800 bg-[#121212] px-3 py-2 text-xs text-zinc-400">
                Showing corpus results ranked by text/tag/symbol match,
                confidence, and recency.
              </div>
            )}
            {readerMode === "feed" && (
              <div className="border-b border-zinc-800 bg-[#121212] px-3 py-2 text-xs text-zinc-400">
                Showing latest captured posts across all threads, newest first.
              </div>
            )}
            {readerMode === "corpus" && !corpusSearched ? (
              <CorpusOverview
                overview={corpusOverview}
                onTermBlacklist={(term) => void blacklistCorpusTerm(term)}
                onTermRemoveBlacklist={(term) =>
                  void removeCorpusBlacklistTerm(term)
                }
                onTermSearch={(term) => {
                  if (term.kind === "security") {
                    void runCorpusSearch({
                      query: "",
                      tag: "",
                      symbol: term.value,
                      sentiment: "all",
                      analysisState: "all",
                    });
                    return;
                  }
                  if (term.kind === "tag" || term.kind === "subject") {
                    void runCorpusSearch({
                      query: "",
                      tag: term.value,
                      symbol: "",
                      sentiment: "all",
                      analysisState: "all",
                    });
                    return;
                  }
                  void runCorpusSearch({
                    query: term.value,
                    tag: "",
                    symbol: "",
                    sentiment: "all",
                    analysisState: "all",
                  });
                }}
              />
            ) : (
              <PostList
                posts={activePosts}
                readPostNos={readPostNos}
                scrollRef={readerScrollRef}
                showThreadContext={readerMode === "feed"}
                showImages={
                  readerMode === "thread" ? threadDetail?.thread.active : true
                }
                onImageOpen={(attachment, post) =>
                  openImagePreview(attachment, `Post ${post.post_no}`)
                }
                onPostRead={markPostRead}
                onThreadClick={(threadNo) => {
                  setReaderMode("thread");
                  setSelectedThreadNo(threadNo);
                }}
              />
            )}
          </section>

          <aside className="grid min-h-[72vh] gap-3">
            <section className="border border-zinc-800 bg-[#0a0a0a]">
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
                  <p className="text-sm text-zinc-400">
                    Enter a symbol to collect related /biz/ posts and summarize
                    the bullish and bearish case.
                  </p>
                )}
              </div>
            </section>

            <section className="border border-zinc-800 bg-[#0a0a0a]">
              <PanelHeader icon={<Bell className="h-4 w-4" />} title="Ingest" />
              <div className="grid gap-3 p-3 text-sm">
                <div className="rounded-md border border-zinc-800 bg-[#121212] p-3">
                  {notice}
                </div>
                {activeIngest && (
                  <div className="rounded-md border border-amber-700/60 bg-amber-950/40 p-3 text-amber-100">
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
                <div className="rounded-md border border-zinc-800 bg-[#0a0a0a] p-3">
                  <div className="mb-2 text-[11px] uppercase text-zinc-400">
                    Progress Log
                  </div>
                  <div className="grid max-h-48 gap-2 overflow-y-auto font-mono text-xs text-zinc-300">
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

            <section className="border border-zinc-800 bg-[#0a0a0a]">
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
      <ImagePreviewDialog
        preview={imagePreview}
        zoom={imageZoom}
        fullscreen={imageFullscreen}
        onZoomChange={setImageZoom}
        onFullscreenChange={setImageFullscreen}
        onOpenChange={(open) => {
          if (!open) {
            setImagePreview(null);
            setImageFullscreen(false);
          }
        }}
      />
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
    <div className="flex h-11 items-center justify-between border-b border-zinc-800 px-3">
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
  onTermBlacklist,
  onTermRemoveBlacklist,
  onTermSearch,
}: {
  overview: BizCorpusOverviewDto | null;
  onTermBlacklist: (term: string) => void;
  onTermRemoveBlacklist: (term: string) => void;
  onTermSearch: (term: { value: string; kind?: string }) => void;
}) {
  const [blacklistOpen, setBlacklistOpen] = useState(false);

  if (!overview) {
    return <div className="p-6 text-sm text-zinc-400">Loading corpus...</div>;
  }

  return (
    <div className="grid max-h-[63vh] gap-4 overflow-y-auto p-4">
      <div className="grid gap-2 md:grid-cols-4">
        <Metric label="Window" value={overview.window_label ?? "Recent 24h"} />
        <Metric label="Threads" value={overview.total_threads} />
        <Metric label="Posts" value={overview.total_posts} />
        <Metric
          label="AI analyzed"
          value={overview.analysis_counts.ai_analyzed ?? 0}
        />
      </div>

      <section className="grid gap-3 md:grid-cols-2">
        <TrendingSecuritiesPanel
          securities={overview.trending_securities ?? []}
          onSymbolClick={(symbol) =>
            onTermSearch({ value: symbol, kind: "security" })
          }
        />
        <TermCloud
          icon={<TrendingUp className="h-4 w-4" />}
          title="Top Subjects"
          terms={overview.top_subjects ?? []}
          onTermClick={onTermSearch}
          onTermBlacklist={onTermBlacklist}
        />
      </section>

      <TermCloud
        icon={<BarChart3 className="h-4 w-4" />}
        title="Terminology Heatmap"
        terms={overview.signal_terms ?? overview.heatmap_terms}
        heat
        hint="Click to search; X hides the term"
        action={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setBlacklistOpen(true)}
          >
            <Ban className="h-4 w-4" />
            Manage
            <span className="text-zinc-500">
              {overview.term_blacklist?.length ?? 0}
            </span>
          </Button>
        }
        onTermClick={onTermSearch}
        onTermBlacklist={onTermBlacklist}
      />

      <TermBlacklistDialog
        open={blacklistOpen}
        onOpenChange={setBlacklistOpen}
        terms={overview.term_blacklist ?? []}
        onAdd={onTermBlacklist}
        onRemove={onTermRemoveBlacklist}
      />

      <TermCloud
        icon={<Tags className="h-4 w-4" />}
        title="Top Tags"
        terms={overview.top_tags}
        onTermClick={onTermSearch}
        onTermBlacklist={onTermBlacklist}
      />

      <section>
        <div className="mb-2 text-sm font-semibold">Recent Signal Evidence</div>
        <div className="grid gap-2">
          {overview.recent_posts.slice(0, 8).map((post) => (
            <div
              key={post.id}
              className="border border-zinc-800 bg-[#0a0a0a] p-3"
            >
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                <span className="font-mono">No. {post.post_no}</span>
                <AnalysisBadge state={post.analysis_state} />
                <span>{new Date(post.posted_at).toLocaleString()}</span>
              </div>
              <p className="line-clamp-3 text-sm text-zinc-200">
                {post.clean_text || "[no text]"}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function TrendingSecuritiesPanel({
  securities,
  onSymbolClick,
}: {
  securities: NonNullable<BizCorpusOverviewDto["trending_securities"]>;
  onSymbolClick: (symbol: string) => void;
}) {
  return (
    <section className="border border-zinc-800 bg-[#121212] p-3">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <TrendingUp className="h-4 w-4" />
        Trending Securities
      </div>
      <div className="grid gap-2">
        {securities.length > 0 ? (
          securities.slice(0, 10).map((security) => {
            const neutralMixed = security.mixed + security.neutral;
            const total = Math.max(
              security.bullish + security.bearish + neutralMixed,
              1,
            );
            const bullPercent = Math.round((security.bullish / total) * 100);
            const middlePercent = Math.round((neutralMixed / total) * 100);
            const bearPercent = Math.max(0, 100 - bullPercent - middlePercent);
            return (
              <button
                key={security.symbol}
                type="button"
                onClick={() => onSymbolClick(security.symbol)}
                className="grid gap-1 border border-zinc-800 bg-[#0a0a0a] px-3 py-2 text-left hover:border-emerald-700/60"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-sm font-semibold text-emerald-300">
                    {security.symbol}
                  </span>
                  <span className="text-xs text-zinc-400">
                    {security.count} mentions
                  </span>
                </div>
                <div className="flex h-1.5 overflow-hidden rounded-full bg-zinc-900">
                  <div
                    className="h-full bg-emerald-400"
                    style={{ width: `${bullPercent}%` }}
                  />
                  <div
                    className="h-full bg-zinc-500"
                    style={{ width: `${middlePercent}%` }}
                  />
                  <div
                    className="h-full bg-red-500"
                    style={{ width: `${bearPercent}%` }}
                  />
                </div>
                <div className="flex justify-between text-[11px] text-zinc-400">
                  <span>{security.bullish} bull</span>
                  <span>{security.mixed + security.neutral} neutral/mixed</span>
                  <span>{security.bearish} bear</span>
                </div>
              </button>
            );
          })
        ) : (
          <span className="text-sm text-zinc-400">No securities yet.</span>
        )}
      </div>
    </section>
  );
}

function TermBlacklistDialog({
  open,
  onOpenChange,
  terms,
  onAdd,
  onRemove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  terms: BizTermBlacklistEntryDto[];
  onAdd: (term: string) => void;
  onRemove: (term: string) => void;
}) {
  const [manualTerm, setManualTerm] = useState("");

  function submitManualTerm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const term = manualTerm.trim();
    if (!term) return;
    onAdd(term);
    setManualTerm("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-hidden border-zinc-800 bg-[#0a0a0a] text-zinc-100 sm:max-w-2xl">
        <div>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Ban className="h-4 w-4" />
            Term Blacklist
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm text-zinc-400">
            Hidden terms are excluded from corpus heatmaps and overview lists.
          </DialogDescription>
        </div>
        <section className="border border-zinc-800 bg-[#121212] p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-sm font-semibold">Hidden Terms</span>
            <span className="text-xs text-zinc-500">{terms.length} hidden</span>
          </div>
          <form onSubmit={submitManualTerm} className="mb-3 flex gap-2">
            <Input
              value={manualTerm}
              onChange={(event) => setManualTerm(event.target.value)}
              placeholder="Add hidden term"
              className="h-8"
            />
            <Button type="submit" size="sm" variant="outline">
              <Ban className="h-4 w-4" />
              Hide
            </Button>
          </form>
          <div className="max-h-[42vh] overflow-y-auto">
            <div className="flex flex-wrap gap-2">
              {terms.length > 0 ? (
                terms.map((term) => (
                  <span
                    key={term.id}
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-[#0a0a0a] px-2 py-1 text-xs text-zinc-200"
                  >
                    {term.normalized_term}
                    <button
                      type="button"
                      title={`Remove ${term.normalized_term}`}
                      onClick={() => onRemove(term.normalized_term)}
                      className="text-zinc-500 hover:text-emerald-300"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))
              ) : (
                <span className="text-sm text-zinc-400">
                  Click a heatmap term to hide it.
                </span>
              )}
            </div>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}

function TermCloud({
  icon,
  title,
  terms,
  heat = false,
  hint,
  action,
  onTermClick,
  onTermBlacklist,
}: {
  icon: ReactNode;
  title: string;
  terms: Array<{ value: string; count: number; weight: number; kind?: string }>;
  heat?: boolean;
  hint?: string;
  action?: ReactNode;
  onTermClick?: (term: { value: string; kind?: string }) => void;
  onTermBlacklist?: (term: string) => void;
}) {
  const max = Math.max(...terms.map((term) => term.weight), 1);

  return (
    <section className="border border-zinc-800 bg-[#121212] p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {icon}
          {title}
        </div>
        <div className="flex items-center gap-2">
          {hint ? <span className="text-xs text-zinc-500">{hint}</span> : null}
          {action}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {terms.length > 0 ? (
          terms.map((term) => {
            const intensity = Math.max(0.18, term.weight / max);
            return (
              <span
                key={term.value}
                className="inline-flex overflow-hidden rounded-md border border-zinc-800 text-xs"
                style={
                  heat
                    ? {
                        backgroundColor: `rgba(16, 185, 129, ${intensity})`,
                      }
                    : undefined
                }
              >
                <button
                  type="button"
                  onClick={() => onTermClick?.(term)}
                  className="px-2 py-1 text-left hover:bg-white/5"
                >
                  {term.value}{" "}
                  <span className="text-zinc-400">{term.count}</span>
                </button>
                {onTermBlacklist ? (
                  <button
                    type="button"
                    title={`Hide ${term.value}`}
                    onClick={() => onTermBlacklist(term.value)}
                    className="border-l border-zinc-800 px-1.5 text-zinc-500 hover:bg-red-500/10 hover:text-red-300"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </span>
            );
          })
        ) : (
          <span className="text-sm text-zinc-400">No terms yet.</span>
        )}
      </div>
    </section>
  );
}

function PostList({
  posts,
  readPostNos,
  scrollRef,
  showThreadContext = false,
  showImages = true,
  onImageOpen,
  onPostRead,
  onThreadClick,
}: {
  posts: BizPostDto[];
  readPostNos: Record<string, number>;
  scrollRef: RefObject<HTMLDivElement | null>;
  showThreadContext?: boolean;
  showImages?: boolean;
  onImageOpen?: (attachment: BizAttachmentDto, post: BizPostDto) => void;
  onPostRead?: (post: BizPostDto) => void;
  onThreadClick?: (threadNo: number) => void;
}) {
  if (posts.length === 0) {
    return (
      <div className="p-6 text-sm text-zinc-400">No posts loaded yet.</div>
    );
  }

  return (
    <div ref={scrollRef} className="max-h-[63vh] overflow-y-auto">
      {posts.map((post) => (
        <PostArticle
          key={post.id}
          post={post}
          read={isPostRead(post, readPostNos)}
          showThreadContext={showThreadContext}
          showImages={showImages}
          onImageOpen={onImageOpen}
          onPostRead={onPostRead}
          onThreadClick={onThreadClick}
        />
      ))}
    </div>
  );
}

function PostArticle({
  post,
  read,
  showThreadContext,
  showImages,
  onImageOpen,
  onPostRead,
  onThreadClick,
}: {
  post: BizPostDto;
  read: boolean;
  showThreadContext: boolean;
  showImages: boolean;
  onImageOpen?: (attachment: BizAttachmentDto, post: BizPostDto) => void;
  onPostRead?: (post: BizPostDto) => void;
  onThreadClick?: (threadNo: number) => void;
}) {
  const aiSummary = post.tags.find((tag) => tag.tag_type === "ai_summary");
  const visibleTags = post.tags
    .filter((tag) => tag.tag_type !== "ai_summary")
    .slice(0, 8);

  return (
    <article
      onMouseEnter={() => onPostRead?.(post)}
      className={`border-b p-4 ${
        read ? "border-zinc-800/80" : "border-amber-700/60 bg-amber-950/30"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
        <span className="font-mono">No. {post.post_no}</span>
        {showThreadContext && (
          <button
            type="button"
            onClick={() => onThreadClick?.(post.thread_no)}
            className="font-mono text-emerald-400 hover:text-emerald-200"
          >
            Thread {post.thread_no}
          </button>
        )}
        <span>{new Date(post.posted_at).toLocaleString()}</span>
        <AnalysisBadge state={post.analysis_state} />
        {!read && <Badge className="bg-amber-500 text-black">new</Badge>}
        <a
          href={post.source_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 hover:text-zinc-100"
        >
          source <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      {showThreadContext && (
        <div className="mt-2 border-l-2 border-zinc-800 pl-3 text-xs text-zinc-400">
          {post.thread_subject || "Untitled thread"}
        </div>
      )}
      {post.subject && (
        <h2 className="mt-2 text-base font-semibold">{post.subject}</h2>
      )}
      {showImages && post.thread_active !== false && post.attachment && (
        <AttachmentPreview
          attachment={post.attachment}
          onOpen={(attachment) => onImageOpen?.(attachment, post)}
        />
      )}
      {aiSummary && <PostSummary summary={aiSummary.value} />}
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-200">
        {post.clean_text || "[no text]"}
      </p>
      <div className="mt-3 flex flex-wrap gap-1">
        {post.security_mentions.map((mention) => (
          <Badge
            key={mention.id}
            variant={mention.stance === "bearish" ? "destructive" : "secondary"}
          >
            {mention.symbol} {mention.stance}
          </Badge>
        ))}
        {visibleTags.map((tag) => (
          <Badge key={tag.id} variant="outline">
            {tag.tag_type}:{tag.value}
          </Badge>
        ))}
      </div>
    </article>
  );
}

function PostSummary({ summary }: { summary: string }) {
  return (
    <section className="mt-3 border border-emerald-700/50 bg-zinc-900 px-3 py-2 text-sm leading-6 text-emerald-100">
      <div className="mb-1 text-[11px] font-semibold uppercase text-emerald-300">
        AI summary
      </div>
      {summary}
    </section>
  );
}

function AttachmentPreview({
  attachment,
  compact = false,
  onOpen,
}: {
  attachment: BizAttachmentDto;
  compact?: boolean;
  onOpen?: (attachment: BizAttachmentDto) => void;
}) {
  if (attachment.file_deleted) return null;

  const imageUrl = attachment.thumbnail_url ?? attachment.media_url;
  const mediaUrl = attachment.media_url ?? imageUrl;
  if (!imageUrl || !mediaUrl) return null;

  const dimensions =
    attachment.width && attachment.height
      ? `${attachment.width}x${attachment.height}`
      : null;
  const filename = [attachment.filename, attachment.ext]
    .filter(Boolean)
    .join("");

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpen?.(attachment);
      }}
      className={
        compact
          ? "mt-2 block w-fit"
          : "mt-3 block w-fit rounded-md border border-zinc-800 bg-[#121212] p-2 text-left hover:border-emerald-800"
      }
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- Direct remote 4cdn preview; do not proxy or persist attachments. */}
      <img
        src={imageUrl}
        alt={filename || "post attachment"}
        loading="lazy"
        referrerPolicy="no-referrer"
        className={
          compact
            ? "h-20 w-20 rounded border border-zinc-800 object-cover"
            : "max-h-80 max-w-full rounded object-contain"
        }
      />
      {!compact && (filename || dimensions) && (
        <div className="mt-1 text-xs text-zinc-400">
          {[filename, dimensions].filter(Boolean).join(" · ")}
        </div>
      )}
    </button>
  );
}

function ImagePreviewDialog({
  preview,
  zoom,
  fullscreen,
  onZoomChange,
  onFullscreenChange,
  onOpenChange,
}: {
  preview: ImagePreview | null;
  zoom: number;
  fullscreen: boolean;
  onZoomChange: (zoom: number) => void;
  onFullscreenChange: (fullscreen: boolean) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const attachment = preview?.attachment;
  const imageUrl = attachment?.media_url ?? attachment?.thumbnail_url;
  const filename = attachment
    ? [attachment.filename, attachment.ext].filter(Boolean).join("")
    : "";
  const dimensions =
    attachment?.width && attachment.height
      ? `${attachment.width}x${attachment.height}`
      : null;

  return (
    <Dialog open={Boolean(preview)} onOpenChange={onOpenChange}>
      <DialogContent
        className={`grid grid-rows-[auto_minmax(0,1fr)] gap-0 border-zinc-800 bg-zinc-950 p-0 text-white ${
          fullscreen
            ? "h-[94vh] w-[96vw] max-w-[96vw]"
            : "h-[50vh] w-[50vw] max-w-[50vw] min-w-[360px]"
        }`}
      >
        <div className="flex min-h-14 items-center justify-between gap-3 border-b border-zinc-800 px-4 pr-12">
          <div>
            <DialogTitle className="text-sm text-white">
              {preview?.title ?? "Image preview"}
            </DialogTitle>
            <DialogDescription className="mt-1 text-xs text-zinc-400">
              {[filename, dimensions].filter(Boolean).join(" · ") ||
                "Remote attachment preview"}
            </DialogDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
              onClick={() => onZoomChange(Math.max(1, zoom - 0.25))}
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="w-14 text-center font-mono text-xs text-zinc-300">
              {Math.round(zoom * 100)}%
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
              onClick={() => onZoomChange(Math.min(3, zoom + 0.25))}
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
              onClick={() => onFullscreenChange(!fullscreen)}
            >
              {fullscreen ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </Button>
            {imageUrl && (
              <a
                href={imageUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center gap-2 border border-zinc-700 px-3 text-xs text-zinc-200 hover:bg-zinc-900"
              >
                <ExternalLink className="h-4 w-4" />
                Open
              </a>
            )}
          </div>
        </div>
        <div className="overflow-auto p-4">
          {imageUrl && (
            <div className="flex min-h-full items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element -- Direct remote 4cdn preview; do not proxy or persist attachments. */}
              <img
                src={imageUrl}
                alt={filename || "post attachment"}
                referrerPolicy="no-referrer"
                className="rounded border border-zinc-800 object-contain"
                style={{
                  maxWidth: zoom === 1 ? "100%" : "none",
                  maxHeight: zoom === 1 ? "100%" : "none",
                  width: zoom === 1 ? "auto" : `${zoom * 100}%`,
                  transformOrigin: "center center",
                }}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
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
      <p className="rounded-md border border-zinc-800 bg-[#121212] p-3 leading-6">
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
              className="border-l-2 border-emerald-800 pl-3"
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
    <div className="rounded-md border border-zinc-800 bg-[#0a0a0a] px-3 py-2">
      <div className="text-[11px] uppercase text-zinc-400">{label}</div>
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
    <div className="rounded-md border border-zinc-800 bg-[#0a0a0a] p-3">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-zinc-200">{progress.message}</span>
        <span className="font-mono text-zinc-400">{percent}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-900">
        <div
          className="h-full rounded-full bg-emerald-400 transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-zinc-400">
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
    <div className="rounded-md border border-zinc-800 bg-[#0a0a0a] p-3">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-zinc-200">
          {status?.current_message ?? "Analysis status unavailable"}
        </span>
        <span className="font-mono text-zinc-400">{percent}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-900">
        <div
          className="h-full rounded-full bg-emerald-400 transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-zinc-400">
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
    <div className="inline-flex h-9 items-center gap-2 border border-zinc-800 bg-[#0a0a0a] px-3 text-sm">
      <span
        className={`h-2 w-2 rounded-full ${
          run?.status === "failed"
            ? "bg-red-500"
            : run?.status === "running"
              ? "bg-amber-500"
              : "bg-emerald-400"
        }`}
      />
      {label}
    </div>
  );
}

function isThreadUnread(
  thread: BizThreadDto,
  readPostNos: Record<string, number>,
) {
  const postNos = thread.post_nos?.length
    ? thread.post_nos
    : thread.latest_post_no
      ? [thread.latest_post_no]
      : [];
  return postNos.some((postNo) => !readPostNos[String(postNo)]);
}

function isPostRead(post: BizPostDto, readPostNos: Record<string, number>) {
  return Boolean(readPostNos[String(post.post_no)]);
}

function migrateLegacyThreadReads(
  threads: BizThreadDto[],
  current: Record<string, number>,
) {
  const legacy = readLocalMap(LEGACY_READ_THREAD_STATE_KEY);
  if (Object.keys(legacy).length === 0) return current;

  let changed = false;
  const next = { ...current };

  for (const thread of threads) {
    const readAt = legacy[String(thread.thread_no)];
    if (!readAt) continue;

    for (const postRef of thread.post_refs ?? []) {
      const key = String(postRef.post_no);
      if (next[key]) continue;

      if (new Date(postRef.first_seen_at).getTime() <= readAt) {
        next[key] = readAt;
        changed = true;
      }
    }
  }

  if (changed) {
    writeLocalMap(READ_POST_STATE_KEY, next);
  }

  return changed ? next : current;
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
