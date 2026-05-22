"use client";

import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Plus,
  RefreshCw,
  Loader2,
  Heart,
  Repeat2,
  MessageCircle,
  ExternalLink,
  Trash2,
  ShieldCheck,
  ShieldAlert,
  Activity,
  TrendingUp,
  TrendingDown,
  Sparkles,
} from "lucide-react";
import type {
  XAccountDto,
  XAnalysisStatusDto,
  XCredentialsStatusDto,
  XIngestStatusDto,
  XSentiment,
  XSentimentOverviewDto,
  XTweetDto,
} from "@moneytree/shared";

import { AppNavbar } from "@/components/navbar/presets/app";
import { SourceSwitcher } from "@/components/navbar/custom/source-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TickerSymbol } from "@/components/ticker/ticker-symbol";
import { ConnectXModal } from "@/components/x/connect-x-modal";
import { RootStoreContext } from "@/context/rootStoreContext";
import useAuthGuard from "@/hooks/useAuthGuard";
import { fetchWithAuth } from "@/lib/utils";

const API_BASE =
  process.env.NEXT_PUBLIC_NEST_BACKEND_URL || "http://localhost:3000";

function formatRelative(iso: string | Date | null) {
  if (!iso) return "—";
  const date = typeof iso === "string" ? new Date(iso) : iso;
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatCount(n: number | null | undefined) {
  if (n == null) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

type WindowKey = "1d" | "7d" | "30d" | "90d" | "all";

const WINDOWS: { key: WindowKey; label: string }[] = [
  { key: "1d", label: "1d" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "90d", label: "3mo" },
  { key: "all", label: "All" },
];

function sentimentColor(s: XSentiment | null | undefined) {
  switch (s) {
    case "bullish":
      return "bg-emerald-600 text-white";
    case "bearish":
      return "bg-rose-600 text-white";
    case "mixed":
      return "bg-amber-500 text-black";
    case "neutral":
      return "bg-zinc-500 text-white";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export default function HomeXPage() {
  useAuthGuard();
  const rootStore = useContext(RootStoreContext);
  const token = rootStore.session?.access_token ?? "";

  const [accounts, setAccounts] = useState<XAccountDto[]>([]);
  const [tweets, setTweets] = useState<XTweetDto[]>([]);
  const [creds, setCreds] = useState<XCredentialsStatusDto | null>(null);
  const [ingestStatus, setIngestStatus] = useState<XIngestStatusDto | null>(
    null,
  );
  const [analysisStatus, setAnalysisStatus] =
    useState<XAnalysisStatusDto | null>(null);
  const [sentiment, setSentiment] = useState<XSentimentOverviewDto | null>(
    null,
  );
  const [window, setWindow] = useState<WindowKey>("7d");
  const [selectedHandle, setSelectedHandle] = useState<string | null>(null);
  const [newHandle, setNewHandle] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ingestLoading, setIngestLoading] = useState(false);
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const authFetch = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const response = await fetchWithAuth(token, `${API_BASE}${path}`, init);
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(body || `${response.status} ${response.statusText}`);
      }
      if (response.status === 204) return undefined as T;
      return response.json() as Promise<T>;
    },
    [token],
  );

  const loadAccounts = useCallback(async () => {
    if (!token) return;
    const list = await authFetch<XAccountDto[]>("/x/accounts?activeOnly=true");
    setAccounts(list);
  }, [authFetch, token]);

  const loadTweets = useCallback(
    async (handle?: string | null) => {
      if (!token) return;
      const qs = handle ? `?handle=${encodeURIComponent(handle)}` : "";
      const list = await authFetch<XTweetDto[]>(`/x/tweets${qs}`);
      setTweets(list);
    },
    [authFetch, token],
  );

  const loadCreds = useCallback(async () => {
    if (!token) return;
    const next = await authFetch<XCredentialsStatusDto>("/x/credentials");
    setCreds(next);
  }, [authFetch, token]);

  const loadIngestStatus = useCallback(async () => {
    if (!token) return;
    const next = await authFetch<XIngestStatusDto>("/x/ingest/status");
    setIngestStatus(next);
  }, [authFetch, token]);

  const loadAnalysisStatus = useCallback(async () => {
    if (!token) return;
    const next = await authFetch<XAnalysisStatusDto>("/x/analysis/status");
    setAnalysisStatus(next);
  }, [authFetch, token]);

  const loadSentiment = useCallback(
    async (windowKey: WindowKey, handle?: string | null) => {
      if (!token) return;
      const params = new URLSearchParams({ window: windowKey });
      if (handle) params.set("handle", handle);
      const next = await authFetch<XSentimentOverviewDto>(
        `/x/sentiment?${params.toString()}`,
      );
      setSentiment(next);
    },
    [authFetch, token],
  );

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    Promise.all([
      loadAccounts(),
      loadCreds(),
      loadIngestStatus(),
      loadAnalysisStatus(),
    ])
      .catch((err) => setNotice(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [token, loadAccounts, loadCreds, loadIngestStatus, loadAnalysisStatus]);

  useEffect(() => {
    void loadSentiment(window, selectedHandle);
  }, [window, selectedHandle, loadSentiment]);

  useEffect(() => {
    void loadTweets(selectedHandle);
  }, [selectedHandle, loadTweets]);

  // Poll ingest status while running
  useEffect(() => {
    if (!ingestStatus?.isRunning) return;
    const id = setInterval(() => {
      void loadIngestStatus();
      void loadTweets(selectedHandle);
    }, 4000);
    return () => clearInterval(id);
  }, [ingestStatus?.isRunning, loadIngestStatus, loadTweets, selectedHandle]);

  // Poll analysis status while processing
  useEffect(() => {
    if (!analysisStatus?.isProcessing && (analysisStatus?.pending ?? 0) === 0) {
      return;
    }
    const id = setInterval(() => {
      void loadAnalysisStatus();
      void loadSentiment(window, selectedHandle);
      void loadTweets(selectedHandle);
    }, 6000);
    return () => clearInterval(id);
  }, [
    analysisStatus?.isProcessing,
    analysisStatus?.pending,
    loadAnalysisStatus,
    loadSentiment,
    loadTweets,
    selectedHandle,
    window,
  ]);

  const handleConnect = useCallback(
    async (payload: { auth_token: string; ct0: string }) => {
      const next = await authFetch<XCredentialsStatusDto>("/x/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setCreds(next);
      setNotice(
        next.twitter_handle
          ? `Connected as @${next.twitter_handle}`
          : "X connected",
      );
    },
    [authFetch],
  );

  const handleDisconnect = useCallback(async () => {
    await authFetch("/x/credentials", { method: "DELETE" });
    setCreds({
      connected: false,
      twitter_handle: null,
      is_valid: false,
      last_checked_at: null,
    });
    setNotice("X account disconnected");
  }, [authFetch]);

  const handleAddAccount = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newHandle.trim()) return;
      setAdding(true);
      try {
        await authFetch("/x/accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            handle: newHandle.trim().replace(/^@/, ""),
            label: newLabel.trim() || undefined,
          }),
        });
        setNewHandle("");
        setNewLabel("");
        await loadAccounts();
        setNotice(`Added @${newHandle.trim()}`);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Could not add");
      } finally {
        setAdding(false);
      }
    },
    [authFetch, loadAccounts, newHandle, newLabel],
  );

  const handleRemove = useCallback(
    async (id: string, handle: string) => {
      if (!confirm(`Remove @${handle} from tracking?`)) return;
      await authFetch(`/x/accounts/${id}`, { method: "DELETE" });
      await loadAccounts();
      if (selectedHandle === handle) setSelectedHandle(null);
      setNotice(`Removed @${handle}`);
    },
    [authFetch, loadAccounts, selectedHandle],
  );

  const handleRunIngest = useCallback(async () => {
    setIngestLoading(true);
    setNotice("Triggering ingest…");
    try {
      await authFetch("/x/ingest/run", { method: "POST" });
      await loadIngestStatus();
      setNotice("Ingest started");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Ingest failed");
    } finally {
      setIngestLoading(false);
    }
  }, [authFetch, loadIngestStatus]);

  const handleRunAnalysis = useCallback(async () => {
    setAnalyzeLoading(true);
    setNotice("Analyzing tweets…");
    try {
      const res = await authFetch<{ processed?: number; skipped?: boolean }>(
        "/x/analysis/run",
        { method: "POST" },
      );
      await loadAnalysisStatus();
      await loadSentiment(window, selectedHandle);
      await loadTweets(selectedHandle);
      setNotice(
        res.skipped
          ? "Analysis already running"
          : `Analyzed ${res.processed ?? 0} tweets`,
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setAnalyzeLoading(false);
    }
  }, [
    authFetch,
    loadAnalysisStatus,
    loadSentiment,
    loadTweets,
    selectedHandle,
    window,
  ]);

  const headerTitle = useMemo(() => {
    if (selectedHandle) return `Tweets from @${selectedHandle}`;
    return "All tracked tweets";
  }, [selectedHandle]);

  return (
    <div className="biz-workspace min-h-screen bg-background text-foreground">
      <AppNavbar className="border-b border-border bg-background/95 text-foreground" />
      <div className="pt-16">
        <SourceSwitcher />
      </div>
      <main className="mx-auto grid max-w-[1680px] gap-4 px-4 pb-8 pt-4">
        <section className="grid gap-3 border-b border-border pb-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">
              X (Twitter) Signal Workspace
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Pulls recent tweets via the <code className="rounded bg-muted px-1">bird</code> CLI from a curated list of finance handles.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {creds?.connected ? (
              <Badge className="flex items-center gap-1 bg-emerald-600 text-white">
                <ShieldCheck size={12} />
                Connected{creds.twitter_handle ? ` as @${creds.twitter_handle}` : ""}
              </Badge>
            ) : (
              <Badge className="flex items-center gap-1 bg-amber-500 text-black">
                <ShieldAlert size={12} />
                Not connected
              </Badge>
            )}
            <Button size="sm" variant="outline" onClick={() => setModalOpen(true)}>
              {creds?.connected ? "Update cookies" : "Connect X"}
            </Button>
            {creds?.connected && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleDisconnect}
                className="text-destructive"
              >
                Disconnect
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleRunIngest}
              disabled={ingestLoading || ingestStatus?.isRunning || !creds?.connected}
            >
              {ingestStatus?.isRunning || ingestLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Fetching…
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Run ingest
                </>
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleRunAnalysis}
              disabled={analyzeLoading || analysisStatus?.isProcessing || !analysisStatus?.enabled}
              title={!analysisStatus?.enabled ? "OPENAI_API_KEY not configured" : undefined}
            >
              {analysisStatus?.isProcessing || analyzeLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Analyzing…
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Analyze
                </>
              )}
            </Button>
          </div>
        </section>

        <section className="flex items-center justify-between gap-3 border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Time horizon
            </span>
            <div className="inline-flex overflow-hidden rounded-md border border-border">
              {WINDOWS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setWindow(key)}
                  className={`px-3 py-1 text-xs transition-colors ${
                    window === key
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {selectedHandle && (
              <Badge variant="outline" className="ml-1">
                @{selectedHandle}
              </Badge>
            )}
          </div>
          {analysisStatus && (
            <span className="text-xs text-muted-foreground">
              {analysisStatus.analyzed} analyzed · {analysisStatus.pending} pending
              {analysisStatus.failed > 0 && ` · ${analysisStatus.failed} failed`}
            </span>
          )}
        </section>

        {notice && (
          <div className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            {notice}
          </div>
        )}

        <section className="grid gap-3 lg:grid-cols-[360px_minmax(0,1fr)_360px]">
          {/* Left: Accounts */}
          <aside className="min-h-[72vh] border border-border bg-card">
            <header className="flex items-center justify-between border-b border-border px-3 py-2 text-sm font-medium">
              <span className="flex items-center gap-2">
                <Activity className="h-4 w-4" />
                Tracked accounts
                <span className="text-xs text-muted-foreground">({accounts.length})</span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelectedHandle(null)}
                aria-pressed={selectedHandle === null}
              >
                All
              </Button>
            </header>
            <form onSubmit={handleAddAccount} className="flex flex-col gap-2 border-b border-border p-3">
              <Input
                value={newHandle}
                onChange={(e) => setNewHandle(e.target.value)}
                placeholder="@handle"
                disabled={adding}
              />
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Label (optional)"
                disabled={adding}
              />
              <Button type="submit" size="sm" disabled={adding || !newHandle.trim()}>
                {adding ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                Add account
              </Button>
            </form>
            <div className="max-h-[68vh] overflow-y-auto">
              {accounts.length === 0 && !loading && (
                <p className="px-3 py-4 text-sm text-muted-foreground">
                  No accounts yet — add a handle above.
                </p>
              )}
              {accounts.map((account) => {
                const active = selectedHandle === account.handle;
                return (
                  <div
                    key={account.id}
                    className={`group flex items-center justify-between gap-2 border-b border-border/80 px-3 py-2 text-left hover:bg-muted ${
                      active ? "bg-muted" : ""
                    }`}
                  >
                    <button
                      onClick={() => setSelectedHandle(account.handle)}
                      className="flex flex-1 flex-col items-start"
                    >
                      <span className="font-mono text-sm text-foreground">@{account.handle}</span>
                      {account.label && (
                        <span className="text-xs text-muted-foreground">{account.label}</span>
                      )}
                      <span className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                        last fetch: {account.last_fetch_at ? formatRelative(account.last_fetch_at) : "never"}
                      </span>
                    </button>
                    <button
                      onClick={() => handleRemove(account.id, account.handle)}
                      className="opacity-0 transition-opacity group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                      title="Remove"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          </aside>

          {/* Middle: Tweets */}
          <section className="min-h-[72vh] border border-border bg-card">
            <header className="flex items-center justify-between border-b border-border px-3 py-2 text-sm font-medium">
              <span>{headerTitle}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void loadTweets(selectedHandle)}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </header>
            <div className="max-h-[72vh] overflow-y-auto">
              {tweets.length === 0 && (
                <p className="px-3 py-6 text-sm text-muted-foreground">
                  {creds?.connected
                    ? "No tweets yet — click 'Run ingest' to fetch."
                    : "Connect your X account, then run an ingest."}
                </p>
              )}
              {tweets.map((tweet) => (
                <article
                  key={tweet.id}
                  className="border-b border-border/80 px-4 py-3"
                >
                  <header className="mb-1 flex items-center justify-between gap-2 text-xs">
                    <button
                      onClick={() => setSelectedHandle(tweet.handle)}
                      className="font-mono font-medium text-foreground hover:underline"
                    >
                      @{tweet.handle}
                    </button>
                    <a
                      href={tweet.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                    >
                      {new Date(tweet.posted_at).toLocaleString()}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </header>
                  <p className="whitespace-pre-wrap text-sm text-foreground">{tweet.text}</p>
                  {tweet.summary && (
                    <p className="mt-1 text-xs italic text-muted-foreground">
                      AI: {tweet.summary}
                    </p>
                  )}
                  <footer className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {tweet.sentiment && (
                      <Badge className={sentimentColor(tweet.sentiment)}>
                        {tweet.sentiment}
                        {tweet.confidence != null && (
                          <span className="ml-1 opacity-80">
                            {Math.round(tweet.confidence * 100)}%
                          </span>
                        )}
                      </Badge>
                    )}
                    {tweet.subject && tweet.subject !== "not_market_relevant" && (
                      <Badge variant="outline">{tweet.subject}</Badge>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <Heart className="h-3 w-3" /> {formatCount(tweet.likes)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Repeat2 className="h-3 w-3" /> {formatCount(tweet.retweets)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MessageCircle className="h-3 w-3" /> {formatCount(tweet.replies)}
                    </span>
                    {tweet.is_retweet && <Badge variant="outline">retweet</Badge>}
                  </footer>
                </article>
              ))}
            </div>
          </section>

          {/* Right: Sentiment + Status */}
          <aside className="min-h-[72vh] border border-border bg-card">
            <header className="flex items-center justify-between border-b border-border px-3 py-2 text-sm font-medium">
              <span className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                Sentiment ({window})
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void loadSentiment(window, selectedHandle)}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </header>

            <div className="space-y-3 p-3 text-sm">
              {/* Overall tweet sentiment */}
              {sentiment && (
                <div className="rounded border border-border bg-muted/40 p-3">
                  <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Overall tweet mood
                  </h4>
                  {sentiment.tweet_sentiment.total === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No analyzed tweets in this window yet.
                    </p>
                  ) : (
                    <>
                      <div className="mb-2 flex h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="bg-emerald-600"
                          style={{
                            width: `${
                              (sentiment.tweet_sentiment.bullish /
                                sentiment.tweet_sentiment.total) *
                              100
                            }%`,
                          }}
                        />
                        <div
                          className="bg-rose-600"
                          style={{
                            width: `${
                              (sentiment.tweet_sentiment.bearish /
                                sentiment.tweet_sentiment.total) *
                              100
                            }%`,
                          }}
                        />
                        <div
                          className="bg-amber-500"
                          style={{
                            width: `${
                              (sentiment.tweet_sentiment.mixed /
                                sentiment.tweet_sentiment.total) *
                              100
                            }%`,
                          }}
                        />
                        <div
                          className="bg-zinc-500"
                          style={{
                            width: `${
                              (sentiment.tweet_sentiment.neutral /
                                sentiment.tweet_sentiment.total) *
                              100
                            }%`,
                          }}
                        />
                      </div>
                      <div className="grid grid-cols-4 gap-1 text-center text-[11px]">
                        <div>
                          <div className="font-medium text-emerald-600">
                            {sentiment.tweet_sentiment.bullish}
                          </div>
                          <div className="text-muted-foreground">bull</div>
                        </div>
                        <div>
                          <div className="font-medium text-rose-600">
                            {sentiment.tweet_sentiment.bearish}
                          </div>
                          <div className="text-muted-foreground">bear</div>
                        </div>
                        <div>
                          <div className="font-medium text-amber-600">
                            {sentiment.tweet_sentiment.mixed}
                          </div>
                          <div className="text-muted-foreground">mixed</div>
                        </div>
                        <div>
                          <div className="font-medium text-zinc-500">
                            {sentiment.tweet_sentiment.neutral}
                          </div>
                          <div className="text-muted-foreground">neutral</div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Top tickers */}
              <div>
                <h4 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Top tickers
                </h4>
                {!sentiment || sentiment.tickers.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No ticker mentions in this window.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {sentiment.tickers.slice(0, 12).map((t) => {
                      const direction =
                        t.net > 0 ? "bull" : t.net < 0 ? "bear" : "mixed";
                      return (
                        <li
                          key={t.symbol}
                          className="flex items-center justify-between rounded px-2 py-1 hover:bg-accent"
                        >
                          <div className="flex items-center gap-2">
                            {direction === "bull" && (
                              <TrendingUp className="h-3 w-3 text-emerald-600" />
                            )}
                            {direction === "bear" && (
                              <TrendingDown className="h-3 w-3 text-rose-600" />
                            )}
                            <TickerSymbol symbol={t.symbol} withDollar />
                            <span className="text-xs text-muted-foreground">
                              {t.total}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 text-[10px]">
                            <span className="rounded bg-emerald-600/20 px-1 text-emerald-700 dark:text-emerald-400">
                              {t.bullish}
                            </span>
                            <span className="rounded bg-rose-600/20 px-1 text-rose-700 dark:text-rose-400">
                              {t.bearish}
                            </span>
                            <span className="rounded bg-zinc-500/20 px-1 text-zinc-600 dark:text-zinc-400">
                              {t.neutral + t.mixed}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* Ingest + connection (compact) */}
              <details className="rounded border border-border bg-muted/30">
                <summary className="cursor-pointer px-3 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Ingest & connection
                </summary>
                <div className="space-y-2 px-3 pb-3 text-xs">
                  {ingestStatus?.activeRun ? (
                    <div>
                      <span className="font-medium">Running:</span>{" "}
                      {ingestStatus.activeRun.accounts_checked}/
                      {ingestStatus.activeRun.accounts_planned} accounts ·{" "}
                      {ingestStatus.activeRun.new_tweets} new
                    </div>
                  ) : (
                    <div className="text-muted-foreground">
                      Idle. Cron every 30 minutes.
                    </div>
                  )}
                  {ingestStatus?.lastFinishedRun && (
                    <div className="text-muted-foreground">
                      Last: {ingestStatus.lastFinishedRun.status} ·{" "}
                      {ingestStatus.lastFinishedRun.new_tweets} new ·{" "}
                      {ingestStatus.lastFinishedRun.finished_at
                        ? formatRelative(ingestStatus.lastFinishedRun.finished_at)
                        : "—"}
                    </div>
                  )}
                  <div>
                    Connection:{" "}
                    {creds?.connected
                      ? creds.is_valid
                        ? `valid${creds.twitter_handle ? ` (@${creds.twitter_handle})` : ""}`
                        : "invalid — reconnect"
                      : "not connected"}
                  </div>
                </div>
              </details>
            </div>
          </aside>
        </section>
      </main>

      <ConnectXModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onSubmit={handleConnect}
      />
    </div>
  );
}
