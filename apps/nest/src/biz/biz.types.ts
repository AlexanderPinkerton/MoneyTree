export interface FourChanCatalogPage {
  page: number;
  threads: FourChanPost[];
}

export interface FourChanThreadResponse {
  posts: FourChanPost[];
}

export interface FourChanPost {
  no: number;
  resto?: number;
  now?: string;
  time: number;
  name?: string;
  trip?: string;
  id?: string;
  sub?: string;
  com?: string;
  tim?: number;
  filename?: string;
  ext?: string;
  fsize?: number;
  md5?: string;
  w?: number;
  h?: number;
  tn_w?: number;
  tn_h?: number;
  filedeleted?: number;
  spoiler?: number;
  replies?: number;
  images?: number;
  sticky?: number;
  closed?: number;
  archived?: number;
  archived_on?: number;
  last_modified?: number;
  semantic_url?: string;
  last_replies?: FourChanPost[];
}

export interface FetchJsonResult<T> {
  status: "ok" | "not_modified" | "error";
  data?: T;
  lastModified?: string | null;
  errorMessage?: string;
}

export interface NormalizedPost {
  postNo: number;
  threadNo: number;
  isOp: boolean;
  subject: string | null;
  authorName: string | null;
  posterId: string | null;
  postedAt: Date;
  sourceUrl: string;
  rawCommentHtml: string | null;
  cleanText: string;
  rawJson: FourChanPost;
  attachment: unknown | null;
}

export interface TriageResult {
  tags: Array<{
    tag_type: string;
    value: string;
    confidence: number;
    source: string;
  }>;
  mentions: Array<{
    symbol: string;
    display_name: string | null;
    asset_type: string | null;
    sentiment: string;
    stance: string;
    confidence: number;
    evidence_snippet: string | null;
    source: string;
  }>;
}
