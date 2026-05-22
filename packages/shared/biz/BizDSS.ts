export type BizIngestStatus = "running" | "completed" | "failed";

export type BizAnalysisStage = "triage" | "ai_enrichment" | "summary";

export type BizAnalysisJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export type BizSentiment = "bullish" | "bearish" | "neutral" | "mixed";
export type BizPostAnalysisState =
  | "raw"
  | "triaged"
  | "ai_queued"
  | "ai_analyzed"
  | "failed"
  | "stale";

export interface BizAttachmentDto {
  tim?: number;
  filename?: string | null;
  ext?: string | null;
  fsize?: number | null;
  md5?: string | null;
  width?: number | null;
  height?: number | null;
  thumbnail_width?: number | null;
  thumbnail_height?: number | null;
  file_deleted?: boolean;
  spoiler?: boolean;
  media_url?: string;
  thumbnail_url?: string;
}

export interface BizThreadDto {
  id: string;
  board: string;
  thread_no: number;
  subject: string | null;
  semantic_url: string | null;
  source_url: string;
  replies: number;
  images: number;
  sticky: boolean;
  closed: boolean;
  active: boolean;
  archived: boolean;
  last_modified: string | null;
  first_seen_at: string;
  last_seen_at: string;
  post_count?: number;
  latest_post_at?: string | null;
  latest_post_no?: number | null;
  post_nos?: number[];
  post_refs?: Array<{ post_no: number; first_seen_at: string }>;
  attachment?: BizAttachmentDto | null;
}

export interface BizPostTagDto {
  id: string;
  tag_type: string;
  value: string;
  confidence: number;
  source: string;
}

export interface BizSecurityMentionDto {
  id: string;
  thread_no: number;
  symbol: string;
  display_name: string | null;
  asset_type: string | null;
  sentiment: BizSentiment;
  stance: BizSentiment;
  confidence: number;
  evidence_snippet: string | null;
  source: string;
  post_id?: string;
  post_no?: number;
  posted_at?: string;
}

export interface BizPostDto {
  id: string;
  board: string;
  post_no: number;
  thread_no: number;
  thread_subject?: string | null;
  thread_source_url?: string | null;
  thread_active?: boolean | null;
  is_op: boolean;
  subject: string | null;
  author_name: string | null;
  poster_id: string | null;
  posted_at: string;
  source_url: string;
  clean_text: string;
  attachment: BizAttachmentDto | null;
  analysis_state: BizPostAnalysisState;
  triaged_at: string | null;
  ai_analyzed_at: string | null;
  analysis_model: string | null;
  analysis_version: string | null;
  analysis_error: string | null;
  analyzed_at: string | null;
  first_seen_at: string;
  updated_at: string;
  tags: BizPostTagDto[];
  security_mentions: BizSecurityMentionDto[];
}

export interface BizIngestRunDto {
  id: string;
  status: BizIngestStatus;
  started_at: string;
  finished_at: string | null;
  catalog_threads: number;
  threads_planned: number;
  threads_checked: number;
  threads_changed: number;
  new_threads: number;
  new_posts: number;
  updated_posts: number;
  error_count: number;
  error_message: string | null;
}

export interface BizIngestStatusDto {
  latest_run: BizIngestRunDto | null;
  next_poll_hint_seconds: number;
  queued_analysis_jobs: number;
  failed_analysis_jobs: number;
  ai_enabled?: boolean;
  queued_triage_jobs?: number;
  completed_triage_jobs?: number;
  queued_ai_jobs?: number;
  completed_ai_jobs?: number;
  skipped_ai_jobs?: number;
  total_threads: number;
  total_posts: number;
  latest_post_at: string | null;
}

export interface BizAnalysisStatusDto {
  ai_enabled: boolean;
  running: boolean;
  paused: boolean;
  triage_running: boolean;
  triage_paused: boolean;
  batch_size: number;
  concurrency: number;
  triage_batch_size: number;
  triage_concurrency: number;
  ai_batch_size: number;
  ai_concurrency: number;
  queued_triage: number;
  running_triage_jobs: number;
  completed_triage: number;
  failed_triage: number;
  queued: number;
  running_jobs: number;
  completed: number;
  failed: number;
  skipped: number;
  analyzable_posts: number;
  analyzed_posts: number;
  progress_percent: number;
  last_started_at: string | null;
  last_finished_at: string | null;
  current_message: string;
}

export interface BizSearchResponseDto {
  posts: BizPostDto[];
  total: number;
}

export interface BizCorpusTermDto {
  value: string;
  count: number;
  weight: number;
}

export interface BizCorpusOverviewDto {
  generated_at: string;
  total_threads: number;
  total_posts: number;
  analysis_counts: Record<BizPostAnalysisState, number>;
  stance_counts: Record<BizSentiment, number>;
  top_securities: BizCorpusTermDto[];
  top_tags: BizCorpusTermDto[];
  heatmap_terms: BizCorpusTermDto[];
  recent_posts: BizPostDto[];
}

export interface BizThreadDetailDto {
  thread: BizThreadDto;
  posts: BizPostDto[];
}

export interface BizSecuritySummaryDto {
  symbol: string;
  generated_at: string;
  total_mentions: number;
  bullish_count: number;
  bearish_count: number;
  neutral_count: number;
  mixed_count: number;
  summary: string;
  bullish_points: string[];
  bearish_points: string[];
  recent_mentions: BizSecurityMentionDto[];
}

export interface BizRealtimeEventDto {
  type: "biz_update";
  event:
    | "ingest_started"
    | "ingest_progress"
    | "ingest_completed"
    | "ingest_failed"
    | "new_posts"
    | "analysis_completed";
  run_id?: string;
  phase?: string;
  catalog_threads?: number;
  threads_planned?: number;
  threads_checked?: number;
  threads_changed?: number;
  new_posts?: number;
  new_threads?: number;
  updated_posts?: number;
  error_count?: number;
  message?: string;
}
