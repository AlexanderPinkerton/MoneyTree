// X (Twitter) workspace shared DTOs

export interface XAccountDto {
  id: string;
  handle: string;
  display_name: string | null;
  label: string | null;
  weight: number;
  is_default: boolean;
  is_active: boolean;
  last_fetch_at: string | null;
  created_at: string;
}

export type XSentiment = "bullish" | "bearish" | "neutral" | "mixed";

export interface XTweetDto {
  id: string;
  tweet_id: string;
  handle: string;
  text: string;
  likes: number;
  retweets: number;
  replies: number;
  views: number | null;
  is_retweet: boolean;
  retweet_of: string | null;
  reply_to: string | null;
  url: string;
  posted_at: string;
  media: unknown | null;
  first_seen_at: string;
  analysis_state: string;
  market_relevant: boolean | null;
  subject: string | null;
  sentiment: XSentiment | null;
  stance: XSentiment | null;
  confidence: number | null;
  summary: string | null;
  analyzed_at: string | null;
}

export interface XTickerSentimentDto {
  symbol: string;
  total: number;
  bullish: number;
  bearish: number;
  neutral: number;
  mixed: number;
  avg_confidence: number;
  net: number;
}

export interface XSentimentOverviewDto {
  window: "1d" | "7d" | "30d" | "90d" | "all";
  since: string | null;
  handle: string | null;
  tweet_sentiment: {
    bullish: number;
    bearish: number;
    neutral: number;
    mixed: number;
    total: number;
  };
  tickers: XTickerSentimentDto[];
}

export interface XAnalysisStatusDto {
  enabled: boolean;
  isProcessing: boolean;
  isPaused: boolean;
  pending: number;
  analyzed: number;
  failed: number;
  model: string;
  version: string;
}

export interface XCredentialsStatusDto {
  connected: boolean;
  twitter_handle: string | null;
  is_valid: boolean;
  last_checked_at: string | null;
}

export interface XIngestStatusDto {
  isRunning: boolean;
  activeRun: {
    id: string;
    status: string;
    started_at: string;
    finished_at: string | null;
    accounts_planned: number;
    accounts_checked: number;
    new_tweets: number;
    error_count: number;
    last_error_message: string | null;
  } | null;
  lastFinishedRun: {
    id: string;
    status: string;
    started_at: string;
    finished_at: string | null;
    accounts_checked: number;
    new_tweets: number;
  } | null;
}

export interface XRealtimeEventDto {
  type: "x_update";
  event:
    | "ingest_started"
    | "ingest_progress"
    | "ingest_completed"
    | "ingest_failed"
    | "new_tweets";
  run_id?: string;
  accounts_planned?: number;
  accounts_checked?: number;
  new_tweets?: number;
  error_count?: number;
  handle?: string;
  message?: string;
}
