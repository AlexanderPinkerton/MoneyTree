import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationShutdown,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";

import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { birdJson, BirdError, type BirdCreds } from "./bird.runner";

const TWEETS_PER_HANDLE = 20;
const BETWEEN_HANDLE_DELAY_MS = 1500;
const ACCOUNT_FETCH_TIMEOUT_MS = 30_000;

interface RawTweet {
  id?: string | number;
  id_str?: string;
  text?: string;
  full_text?: string;
  content?: string;
  likes?: number;
  favorite_count?: number;
  retweets?: number;
  retweet_count?: number;
  replies?: number;
  reply_count?: number;
  views?: number;
  view_count?: number;
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
}

@Injectable()
export class XIngestService implements OnApplicationShutdown {
  private readonly logger = new Logger(XIngestService.name);
  private isRunning = false;
  private isShuttingDown = false;
  private activeRunId: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async handleCron() {
    if (this.isRunning) return;
    try {
      await this.runIngest("cron");
    } catch (err) {
      this.logger.warn(
        `x cron ingest failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async onApplicationShutdown() {
    this.isShuttingDown = true;
    if (this.activeRunId) {
      await this.prisma.x_ingest_run
        .update({
          where: { id: this.activeRunId },
          data: {
            status: "failed",
            finished_at: new Date(),
            last_error_message: "Shutdown requested",
          },
        })
        .catch(() => undefined);
    }
  }

  async status() {
    const [activeRun, lastFinishedRun] = await Promise.all([
      this.prisma.x_ingest_run.findFirst({
        where: { status: { in: ["pending", "running"] } },
        orderBy: { started_at: "desc" },
      }),
      this.prisma.x_ingest_run.findFirst({
        where: { status: { in: ["completed", "failed"] } },
        orderBy: { started_at: "desc" },
      }),
    ]);
    return {
      isRunning: this.isRunning,
      activeRun: activeRun
        ? {
            id: activeRun.id,
            status: activeRun.status,
            started_at: activeRun.started_at,
            finished_at: activeRun.finished_at,
            accounts_planned: activeRun.accounts_planned,
            accounts_checked: activeRun.accounts_checked,
            new_tweets: activeRun.new_tweets,
            error_count: activeRun.error_count,
            last_error_message: activeRun.last_error_message,
          }
        : null,
      lastFinishedRun: lastFinishedRun
        ? {
            id: lastFinishedRun.id,
            status: lastFinishedRun.status,
            started_at: lastFinishedRun.started_at,
            finished_at: lastFinishedRun.finished_at,
            accounts_checked: lastFinishedRun.accounts_checked,
            new_tweets: lastFinishedRun.new_tweets,
          }
        : null,
    };
  }

  async runIngest(trigger: string) {
    if (this.isRunning) {
      throw new ConflictException("X ingest already running");
    }
    const creds = await this.pickCreds();
    if (!creds) {
      throw new ServiceUnavailableException(
        "No connected X account — connect cookies before running ingest",
      );
    }

    const accounts = await this.prisma.x_account.findMany({
      where: { is_active: true },
      orderBy: [{ weight: "desc" }, { handle: "asc" }],
    });
    if (accounts.length === 0) {
      throw new NotFoundException("No active X accounts configured");
    }

    const run = await this.prisma.x_ingest_run.create({
      data: {
        status: "running",
        accounts_planned: accounts.length,
        trigger,
      },
    });
    this.activeRunId = run.id;
    this.isRunning = true;

    this.realtime.broadcastXUpdate({
      type: "x_update",
      event: "ingest_started",
      run_id: run.id,
      accounts_planned: accounts.length,
    });

    const counters = {
      accounts_checked: 0,
      new_tweets: 0,
      error_count: 0,
      last_error_message: null as string | null,
    };

    try {
      for (const account of accounts) {
        if (this.isShuttingDown) break;
        try {
          const result = await this.fetchHandle(account.handle, creds);
          counters.new_tweets += result.newCount;
          this.realtime.broadcastXUpdate({
            type: "x_update",
            event: "ingest_progress",
            run_id: run.id,
            handle: account.handle,
            accounts_checked: counters.accounts_checked + 1,
            accounts_planned: accounts.length,
            new_tweets: counters.new_tweets,
          });
          await this.prisma.x_account.update({
            where: { id: account.id },
            data: { last_fetch_at: new Date() },
          });
        } catch (err) {
          counters.error_count += 1;
          const msg =
            err instanceof Error ? err.message : "Unknown bird error";
          counters.last_error_message = `${account.handle}: ${msg}`;
          this.logger.warn(
            `Fetch failed for @${account.handle}: ${msg}`,
          );
          if (err instanceof BirdError && /401|auth/i.test(err.stderr ?? err.message)) {
            // Credentials invalid — short circuit
            await this.prisma.x_credentials.updateMany({
              where: { auth_token: creds.auth_token },
              data: { is_valid: false, last_checked_at: new Date() },
            });
            throw err;
          }
        } finally {
          counters.accounts_checked += 1;
          await this.prisma.x_ingest_run.update({
            where: { id: run.id },
            data: {
              accounts_checked: counters.accounts_checked,
              new_tweets: counters.new_tweets,
              error_count: counters.error_count,
              last_error_message: counters.last_error_message,
            },
          });
        }
        await this.delay(BETWEEN_HANDLE_DELAY_MS);
      }

      await this.prisma.x_ingest_run.update({
        where: { id: run.id },
        data: {
          status: "completed",
          finished_at: new Date(),
        },
      });
      this.realtime.broadcastXUpdate({
        type: "x_update",
        event: "ingest_completed",
        run_id: run.id,
        accounts_planned: accounts.length,
        accounts_checked: counters.accounts_checked,
        new_tweets: counters.new_tweets,
        error_count: counters.error_count,
      });
    } catch (err) {
      await this.prisma.x_ingest_run.update({
        where: { id: run.id },
        data: {
          status: "failed",
          finished_at: new Date(),
          last_error_message:
            err instanceof Error ? err.message : "Unknown ingest error",
        },
      });
      this.realtime.broadcastXUpdate({
        type: "x_update",
        event: "ingest_failed",
        run_id: run.id,
        message: err instanceof Error ? err.message : "Ingest failed",
      });
      throw err;
    } finally {
      this.isRunning = false;
      this.activeRunId = null;
    }

    return { run_id: run.id, ...counters };
  }

  private async pickCreds(): Promise<BirdCreds | null> {
    const row = await this.prisma.x_credentials.findFirst({
      where: { is_valid: true },
      orderBy: { last_checked_at: "desc" },
    });
    if (!row) return null;
    return { auth_token: row.auth_token, ct0: row.ct0 };
  }

  private async fetchHandle(handle: string, creds: BirdCreds) {
    const raw = await birdJson<RawTweet[] | { tweets?: RawTweet[]; data?: RawTweet[] }>(
      ["user-tweets", handle, "-n", String(TWEETS_PER_HANDLE)],
      creds,
      { timeoutMs: ACCOUNT_FETCH_TIMEOUT_MS },
    );

    const tweets = this.normaliseTweets(raw);
    let newCount = 0;
    for (const tw of tweets) {
      const persisted = await this.persistTweet(handle, tw);
      if (persisted) newCount += 1;
    }
    return { newCount };
  }

  private normaliseTweets(raw: unknown): RawTweet[] {
    if (Array.isArray(raw)) return raw as RawTweet[];
    if (raw && typeof raw === "object") {
      const obj = raw as Record<string, unknown>;
      if (Array.isArray(obj.tweets)) return obj.tweets as RawTweet[];
      if (Array.isArray(obj.data)) return obj.data as RawTweet[];
    }
    return [];
  }

  private async persistTweet(handle: string, tw: RawTweet): Promise<boolean> {
    const tweetId = String(tw.id ?? tw.id_str ?? "").trim();
    if (!tweetId) return false;
    const text = tw.text ?? tw.full_text ?? tw.content ?? "";
    const postedAtRaw =
      tw.created_at ?? tw.posted_at ?? tw.time ?? new Date().toISOString();
    const postedAt = new Date(postedAtRaw);
    if (isNaN(postedAt.getTime())) {
      this.logger.warn(`Skipping tweet ${tweetId}: bad timestamp ${postedAtRaw}`);
      return false;
    }
    const url =
      tw.url ?? tw.permalink ?? `https://x.com/${handle}/status/${tweetId}`;
    const retweetOf =
      typeof tw.retweeted_status === "object" && tw.retweeted_status
        ? String((tw.retweeted_status as any).id ?? "") || null
        : typeof tw.retweeted_status === "string"
          ? tw.retweeted_status
          : null;

    try {
      await this.prisma.x_tweet.upsert({
        where: { tweet_id: tweetId },
        create: {
          tweet_id: tweetId,
          handle,
          text,
          likes: tw.likes ?? tw.favorite_count ?? 0,
          retweets: tw.retweets ?? tw.retweet_count ?? 0,
          replies: tw.replies ?? tw.reply_count ?? 0,
          views: tw.views ?? tw.view_count ?? null,
          is_retweet: !!tw.is_retweet || !!retweetOf,
          retweet_of: retweetOf,
          reply_to:
            tw.in_reply_to_status_id != null
              ? String(tw.in_reply_to_status_id)
              : tw.reply_to ?? null,
          url,
          posted_at: postedAt,
          raw_json: tw as any,
          media: (tw.media ?? tw.attachments ?? null) as any,
        },
        update: {
          likes: tw.likes ?? tw.favorite_count ?? 0,
          retweets: tw.retweets ?? tw.retweet_count ?? 0,
          replies: tw.replies ?? tw.reply_count ?? 0,
          views: tw.views ?? tw.view_count ?? null,
          raw_json: tw as any,
        },
      });
      // Detect if the upsert was a create by checking if first_seen_at == updated_at
      const persisted = await this.prisma.x_tweet.findUnique({
        where: { tweet_id: tweetId },
        select: { first_seen_at: true, updated_at: true },
      });
      if (persisted && persisted.first_seen_at.getTime() === persisted.updated_at.getTime()) {
        return true;
      }
      return false;
    } catch (err) {
      this.logger.warn(
        `Failed to persist tweet ${tweetId} for @${handle}: ${
          err instanceof Error ? err.message : err
        }`,
      );
      return false;
    }
  }

  private delay(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
  }
}
