import { Injectable, Logger } from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";

import type { BirdCreds } from "./bird.runner";

import { QUERY_IDS } from "@steipete/bird/dist/lib/twitter-client-constants.js";
import { buildUserTweetsFeatures } from "@steipete/bird/dist/lib/twitter-client-features.js";
import {
  extractCursorFromInstructions,
  parseTweetsFromInstructions,
} from "@steipete/bird/dist/lib/twitter-client-utils.js";

const TWITTER_API_BASE = "https://x.com/i/api/graphql";
const USER_TWEETS_FALLBACK_QUERY_ID = "Wms1GvIiHXAPBaCr9KblaA";
const USER_LOOKUP_QUERY_IDS = [
  "xc8f1g7BYqr6VTzTbvNlGw",
  "qW5u-DAuXpMEG0zA1F7UGQ",
  "sLVLhk0bGj3MVFEKTdax1w",
];
const DEFAULT_TIMEOUT_MS = 30_000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BEARER_TOKEN =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

type DirectTweet = {
  id?: string | number;
  id_str?: string;
  text?: string;
  full_text?: string;
  content?: string;
  _raw?: unknown;
  tweet?: unknown;
  article?: unknown;
  likes?: number;
  favorite_count?: number;
  retweets?: number;
  retweet_count?: number;
  replies?: number;
  reply_count?: number;
  views?: number;
  view_count?: number;
  likeCount?: number;
  retweetCount?: number;
  replyCount?: number;
  viewCount?: number;
  createdAt?: string;
  created_at?: string;
  time?: string;
  posted_at?: string;
  url?: string;
  permalink?: string;
  is_retweet?: boolean;
  retweeted_status?: { id?: string | number } | string;
  in_reply_to_status_id?: string | number;
  reply_to?: string;
  media?: unknown;
  attachments?: unknown;
};

export class XRateLimitError extends Error {
  constructor(
    message: string,
    public readonly retryAt: Date | null,
    public readonly status = 429,
  ) {
    super(message);
    this.name = "XRateLimitError";
  }
}

@Injectable()
export class XGraphqlService {
  private readonly logger = new Logger(XGraphqlService.name);
  private readonly userIdByHandle = new Map<string, string>();

  async userTweets(
    handle: string,
    creds: BirdCreds,
    opts: {
      count: number;
      cursor?: string;
      timeoutMs?: number;
    },
  ): Promise<{ tweets: DirectTweet[]; nextCursor?: string }> {
    const cleanHandle = this.normalizeHandle(handle);
    const userId = await this.lookupUserId(cleanHandle, creds, opts.timeoutMs);
    const features = buildUserTweetsFeatures();
    const queryIds = Array.from(
      new Set([QUERY_IDS.UserTweets, USER_TWEETS_FALLBACK_QUERY_ID]),
    ).filter(Boolean);
    const variables = {
      userId,
      count: opts.count,
      includePromotedContent: false,
      withQuickPromoteEligibilityTweetFields: true,
      withVoice: true,
      ...(opts.cursor ? { cursor: opts.cursor } : {}),
    };
    const fieldToggles = { withArticlePlainText: true };
    const params = new URLSearchParams({
      variables: JSON.stringify(variables),
      features: JSON.stringify(features),
      fieldToggles: JSON.stringify(fieldToggles),
    });

    let lastError: string | null = null;
    for (const queryId of queryIds) {
      const response = await this.fetchWithTimeout(
        `${TWITTER_API_BASE}/${queryId}/UserTweets?${params.toString()}`,
        {
          method: "GET",
          headers: this.headers(creds),
        },
        opts.timeoutMs,
      );
      if (response.status === 404) {
        lastError = "HTTP 404";
        continue;
      }
      if (response.status === 429) {
        throw await this.rateLimitError(response, `@${cleanHandle} timeline`);
      }
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
      }

      const data = (await response.json()) as any;
      const instructions =
        data.data?.user?.result?.timeline?.timeline?.instructions;
      if (data.errors?.length && !instructions) {
        throw new Error(
          data.errors.map((error: any) => error.message).join(", "),
        );
      }

      const tweets = parseTweetsFromInstructions(instructions, {
        quoteDepth: 1,
        includeRaw: true,
      }) as DirectTweet[];
      return {
        tweets: tweets.map((tweet) => ({
          ...tweet,
          url:
            tweet.url ??
            `https://x.com/${cleanHandle}/status/${String(tweet.id ?? "")}`,
        })),
        nextCursor: extractCursorFromInstructions(instructions),
      };
    }

    throw new Error(lastError ?? `Could not fetch @${cleanHandle} timeline`);
  }

  private async lookupUserId(
    handle: string,
    creds: BirdCreds,
    timeoutMs?: number,
  ) {
    const cached = this.userIdByHandle.get(handle);
    if (cached) return cached;

    const variables = {
      screen_name: handle,
      withSafetyModeUserFields: true,
    };
    const features = {
      hidden_profile_subscriptions_enabled: true,
      hidden_profile_likes_enabled: true,
      rweb_tipjar_consumption_enabled: true,
      responsive_web_graphql_exclude_directive_enabled: true,
      verified_phone_label_enabled: false,
      subscriptions_verification_info_is_identity_verified_enabled: true,
      subscriptions_verification_info_verified_since_enabled: true,
      highlights_tweets_tab_ui_enabled: true,
      responsive_web_twitter_article_notes_tab_enabled: true,
      subscriptions_feature_can_gift_premium: true,
      creator_subscriptions_tweet_preview_api_enabled: true,
      responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
      responsive_web_graphql_timeline_navigation_enabled: true,
      blue_business_profile_image_shape_enabled: true,
    };
    const params = new URLSearchParams({
      variables: JSON.stringify(variables),
      features: JSON.stringify(features),
      fieldToggles: JSON.stringify({ withAuxiliaryUserLabels: false }),
    });

    let lastError: string | null = null;
    for (const queryId of USER_LOOKUP_QUERY_IDS) {
      const response = await this.fetchWithTimeout(
        `${TWITTER_API_BASE}/${queryId}/UserByScreenName?${params.toString()}`,
        {
          method: "GET",
          headers: this.headers(creds),
        },
        timeoutMs,
      );
      if (response.status === 404) {
        lastError = "HTTP 404";
        continue;
      }
      if (response.status === 429) {
        throw await this.rateLimitError(response, `@${handle} lookup`);
      }
      if (!response.ok) {
        const text = await response.text();
        lastError = `HTTP ${response.status}: ${text.slice(0, 200)}`;
        continue;
      }

      const data = (await response.json()) as any;
      if (data.data?.user?.result?.__typename === "UserUnavailable") {
        throw new Error(`User @${handle} not found or unavailable`);
      }
      const user = data.data?.user?.result;
      const userId = user?.rest_id;
      if (userId) {
        this.userIdByHandle.set(handle, userId);
        return userId as string;
      }
      lastError = data.errors?.length
        ? data.errors.map((error: any) => error.message).join(", ")
        : "Could not parse user ID from response";
    }

    throw new Error(lastError ?? `Could not look up @${handle}`);
  }

  private async rateLimitError(response: Response, context: string) {
    const retryAt = this.retryAt(response.headers);
    const text = await response.text().catch(() => "");
    return new XRateLimitError(
      `HTTP 429 for ${context}: ${text.slice(0, 200) || "rate limit exceeded"}`,
      retryAt,
    );
  }

  private retryAt(headers: Headers) {
    const retryAfter = headers.get("retry-after");
    if (retryAfter) {
      const seconds = Number.parseInt(retryAfter, 10);
      if (Number.isFinite(seconds))
        return new Date(Date.now() + seconds * 1000);
      const date = new Date(retryAfter);
      if (!Number.isNaN(date.getTime())) return date;
    }

    const reset = headers.get("x-rate-limit-reset");
    if (reset) {
      const value = Number.parseInt(reset, 10);
      if (Number.isFinite(value)) {
        return new Date(value > 10_000_000_000 ? value : value * 1000);
      }
    }

    return null;
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  private headers(creds: BirdCreds) {
    const clientUuid = randomUUID();
    return {
      accept: "*/*",
      "accept-language": "en-US,en;q=0.9",
      authorization: `Bearer ${BEARER_TOKEN}`,
      "content-type": "application/json",
      "x-csrf-token": creds.ct0,
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-active-user": "yes",
      "x-twitter-client-language": "en",
      "x-client-uuid": clientUuid,
      "x-twitter-client-deviceid": randomUUID(),
      "x-client-transaction-id": randomBytes(16).toString("hex"),
      cookie: `auth_token=${creds.auth_token}; ct0=${creds.ct0}`,
      "user-agent": USER_AGENT,
      origin: "https://x.com",
      referer: "https://x.com/",
    };
  }

  private normalizeHandle(handle: string) {
    const cleanHandle = handle.trim().replace(/^@/, "");
    if (!/^[A-Za-z0-9_]{1,15}$/.test(cleanHandle)) {
      throw new Error(`Invalid X handle: ${handle}`);
    }
    return cleanHandle;
  }
}
