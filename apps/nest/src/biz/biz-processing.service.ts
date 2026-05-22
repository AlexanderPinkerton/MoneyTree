import { Injectable, Logger, OnApplicationShutdown } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import type { FourChanPost, NormalizedPost, TriageResult } from "./biz.types";

const COMMON_SECURITIES: Record<
  string,
  { displayName: string; assetType: string }
> = {
  BTC: { displayName: "Bitcoin", assetType: "crypto" },
  ETH: { displayName: "Ethereum", assetType: "crypto" },
  SOL: { displayName: "Solana", assetType: "crypto" },
  XRP: { displayName: "XRP", assetType: "crypto" },
  DOGE: { displayName: "Dogecoin", assetType: "crypto" },
  ADA: { displayName: "Cardano", assetType: "crypto" },
  NVDA: { displayName: "NVIDIA", assetType: "equity" },
  TSLA: { displayName: "Tesla", assetType: "equity" },
  AAPL: { displayName: "Apple", assetType: "equity" },
  MSFT: { displayName: "Microsoft", assetType: "equity" },
  GME: { displayName: "GameStop", assetType: "equity" },
  AMC: { displayName: "AMC Entertainment", assetType: "equity" },
  SPY: { displayName: "SPDR S&P 500 ETF", assetType: "etf" },
  QQQ: { displayName: "Invesco QQQ ETF", assetType: "etf" },
};

const COMPANY_ALIASES: Record<string, string> = {
  bitcoin: "BTC",
  ethereum: "ETH",
  solana: "SOL",
  dogecoin: "DOGE",
  nvidia: "NVDA",
  tesla: "TSLA",
  apple: "AAPL",
  microsoft: "MSFT",
  gamestop: "GME",
};

const BULLISH_WORDS = [
  "bull",
  "bullish",
  "moon",
  "pump",
  "calls",
  "long",
  "breakout",
  "buy",
  "accumulate",
  "rally",
  "undervalued",
];

const BEARISH_WORDS = [
  "bear",
  "bearish",
  "dump",
  "puts",
  "short",
  "crash",
  "sell",
  "rug",
  "overvalued",
  "bankrupt",
  "recession",
];

const TRIAGE_RUNNING_TIMEOUT_MS = 5 * 60 * 1000;

@Injectable()
export class BizProcessingService implements OnApplicationShutdown {
  private readonly logger = new Logger(BizProcessingService.name);
  private readonly batchSize = this.parsePositiveInt(
    process.env.BIZ_TRIAGE_BATCH_SIZE,
    1000,
  );
  private readonly concurrency = this.parsePositiveInt(
    process.env.BIZ_TRIAGE_CONCURRENCY,
    20,
  );
  private isProcessing = false;
  private isPaused = false;
  private isShuttingDown = false;

  constructor(private readonly prisma: PrismaService) {}

  @Interval(5000)
  async processBacklog() {
    if (this.isPaused || this.isShuttingDown) return;
    await this.processQueuedTriage();
  }

  onApplicationShutdown(signal?: string) {
    this.isShuttingDown = true;
    this.isPaused = true;
    this.logger.warn(`Stopping triage${signal ? ` after ${signal}` : ""}`);
  }

  normalizePost(post: FourChanPost, threadNo: number): NormalizedPost {
    const isOp = (post.resto ?? 0) === 0 || post.no === threadNo;
    const sourceUrl = isOp
      ? `https://boards.4chan.org/biz/thread/${threadNo}`
      : `https://boards.4chan.org/biz/thread/${threadNo}#p${post.no}`;

    return {
      postNo: post.no,
      threadNo,
      isOp,
      subject: post.sub ?? null,
      authorName: post.name ?? null,
      posterId: post.id ?? null,
      postedAt: new Date(post.time * 1000),
      sourceUrl,
      rawCommentHtml: post.com ?? null,
      cleanText: this.cleanComment(post.com ?? ""),
      rawJson: post,
      attachment: this.extractAttachment(post),
    };
  }

  async triagePost(postId: string): Promise<TriageResult> {
    const post = await this.prisma.biz_post.findUnique({
      where: { id: postId },
    });

    if (!post) {
      return { tags: [], mentions: [] };
    }

    const text = `${post.subject ?? ""}\n${post.clean_text}`.trim();
    const result = this.classifyText(text);

    await this.prisma.$transaction([
      ...result.tags.map((tag) =>
        this.prisma.biz_post_tag.upsert({
          where: {
            post_id_tag_type_value_source: {
              post_id: post.id,
              tag_type: tag.tag_type,
              value: tag.value,
              source: tag.source,
            },
          },
          update: {
            confidence: tag.confidence,
          },
          create: {
            post_id: post.id,
            ...tag,
          },
        }),
      ),
      ...result.mentions.map((mention) =>
        this.prisma.biz_security_mention.upsert({
          where: {
            post_id_symbol_source: {
              post_id: post.id,
              symbol: mention.symbol,
              source: mention.source,
            },
          },
          update: {
            display_name: mention.display_name,
            asset_type: mention.asset_type,
            sentiment: mention.sentiment,
            stance: mention.stance,
            confidence: mention.confidence,
            evidence_snippet: mention.evidence_snippet,
          },
          create: {
            post_id: post.id,
            thread_no: post.thread_no,
            ...mention,
          },
        }),
      ),
      this.prisma.biz_post.update({
        where: { id: post.id },
        data: {
          analysis_state: "triaged",
          triaged_at: new Date(),
          analyzed_at: new Date(),
          analysis_error: null,
        },
      }),
    ]);

    return result;
  }

  async enqueueTriage(postId: string, threadNo: number) {
    const existing = await this.prisma.biz_analysis_job.findFirst({
      where: {
        stage: "triage",
        post_id: postId,
        status: { in: ["queued", "running"] },
      },
      select: { id: true },
    });

    if (existing) {
      return;
    }

    await this.prisma.biz_analysis_job.create({
      data: {
        stage: "triage",
        status: "queued",
        target_type: "post",
        post_id: postId,
        thread_no: threadNo,
      },
    });
  }

  async processQueuedTriage(limit = this.batchSize) {
    if (this.isProcessing || this.isPaused || this.isShuttingDown) {
      return { completed: 0, failed: 0 };
    }

    this.isProcessing = true;

    try {
      let completed = 0;
      let failed = 0;

      while (!this.isPaused && !this.isShuttingDown) {
        await this.requeueStaleRunningJobs();

        const jobs = await this.prisma.biz_analysis_job.findMany({
          where: { stage: "triage", status: "queued" },
          orderBy: { created_at: "asc" },
          take: limit,
        });

        if (jobs.length === 0) {
          break;
        }

        this.logger.log(
          `Processing ${jobs.length} triage jobs with concurrency ${this.concurrency}`,
        );
        const results = await this.mapWithConcurrency(
          jobs,
          this.concurrency,
          async (job) => this.processTriageJob(job),
        );

        completed += results.filter((result) => result === "completed").length;
        failed += results.filter((result) => result === "failed").length;
      }

      return { completed, failed };
    } finally {
      this.isProcessing = false;
    }
  }

  async start() {
    if (this.isShuttingDown) {
      return this.getStatus();
    }

    this.isPaused = false;
    void this.processQueuedTriage().catch((error) => {
      this.logger.warn(
        `Manual triage failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
    return this.getStatus();
  }

  async pause() {
    this.isPaused = true;
    return this.getStatus();
  }

  async resume() {
    if (this.isShuttingDown) {
      return this.getStatus();
    }

    this.isPaused = false;
    return this.getStatus();
  }

  async getStatus() {
    const [queued, running, completed, failed] = await this.prisma.$transaction(
      [
        this.prisma.biz_analysis_job.count({
          where: { stage: "triage", status: "queued" },
        }),
        this.prisma.biz_analysis_job.count({
          where: { stage: "triage", status: "running" },
        }),
        this.prisma.biz_analysis_job.count({
          where: { stage: "triage", status: "completed" },
        }),
        this.prisma.biz_analysis_job.count({
          where: { stage: "triage", status: "failed" },
        }),
      ],
    );

    return {
      running: this.isProcessing || running > 0,
      paused: this.isPaused,
      batch_size: this.batchSize,
      concurrency: this.concurrency,
      queued,
      running_jobs: running,
      completed,
      failed,
    };
  }

  private async processTriageJob(job: {
    id: string;
    post_id: string | null;
    thread_no: number | null;
  }): Promise<"completed" | "failed"> {
    if (this.isShuttingDown) {
      return "failed";
    }

    await this.prisma.biz_analysis_job.update({
      where: { id: job.id },
      data: {
        status: "running",
        attempts: { increment: 1 },
        started_at: new Date(),
      },
    });

    try {
      this.throwIfShuttingDown();
      if (job.post_id) {
        const result = await this.triagePost(job.post_id);
        this.throwIfShuttingDown();
        if (this.shouldAiEnrich(result)) {
          await this.enqueueAiEnrichment(job.post_id, job.thread_no ?? null);
        }
      }
      this.throwIfShuttingDown();
      await this.prisma.biz_analysis_job.update({
        where: { id: job.id },
        data: { status: "completed", finished_at: new Date() },
      });
      return "completed";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Triage job ${job.id} failed: ${message}`);
      if (this.isShuttingDown) {
        await this.requeueTriageJobDuringShutdown(job, message);
        return "failed";
      }

      await this.prisma.biz_analysis_job.update({
        where: { id: job.id },
        data: {
          status: "failed",
          error_message: message,
          finished_at: new Date(),
        },
      });
      if (job.post_id) {
        await this.prisma.biz_post.update({
          where: { id: job.post_id },
          data: { analysis_state: "failed", analysis_error: message },
        });
      }
      return "failed";
    }
  }

  private async requeueStaleRunningJobs() {
    await this.prisma.biz_analysis_job.updateMany({
      where: {
        stage: "triage",
        status: "running",
        started_at: {
          lt: new Date(Date.now() - TRIAGE_RUNNING_TIMEOUT_MS),
        },
      },
      data: {
        status: "queued",
        started_at: null,
        error_message: "Requeued stale running triage job",
      },
    });
  }

  async enqueueAiEnrichment(postId: string, threadNo: number | null) {
    const existing = await this.prisma.biz_analysis_job.findFirst({
      where: {
        stage: "ai_enrichment",
        post_id: postId,
        status: { in: ["queued", "running", "completed"] },
      },
      select: { id: true, status: true },
    });

    if (existing) {
      if (existing.status !== "completed") {
        await this.prisma.biz_post.update({
          where: { id: postId },
          data: {
            analysis_state: "ai_queued",
            analysis_error: null,
          },
        });
      }
      return;
    }

    await this.prisma.$transaction([
      this.prisma.biz_analysis_job.create({
        data: {
          stage: "ai_enrichment",
          status: "queued",
          target_type: "post",
          post_id: postId,
          thread_no: threadNo,
        },
      }),
      this.prisma.biz_post.update({
        where: { id: postId },
        data: {
          analysis_state: "ai_queued",
          analysis_error: null,
        },
      }),
    ]);
  }

  buildSecuritySummary(
    symbol: string,
    mentions: Array<{
      stance: string;
      evidence_snippet: string | null;
      confidence: number;
      post?: { clean_text: string; posted_at: Date; source_url: string };
    }>,
  ) {
    const bullish = mentions.filter((mention) => mention.stance === "bullish");
    const bearish = mentions.filter((mention) => mention.stance === "bearish");
    const neutral = mentions.filter((mention) => mention.stance === "neutral");
    const mixed = mentions.filter((mention) => mention.stance === "mixed");

    const bullishPoints = this.pickEvidence(bullish, "bullish");
    const bearishPoints = this.pickEvidence(bearish, "bearish");

    const leading =
      bullish.length > bearish.length
        ? "more bullish than bearish"
        : bearish.length > bullish.length
          ? "more bearish than bullish"
          : "balanced or mixed";

    return {
      summary:
        `${symbol.toUpperCase()} discussion is ${leading} across ${mentions.length} captured mentions. ` +
        `Recent bullish evidence centers on ${bullishPoints[0] ?? "limited explicit bullish claims"}, while bearish evidence centers on ${bearishPoints[0] ?? "limited explicit bearish claims"}.`,
      bullishPoints,
      bearishPoints,
      counts: {
        bullish: bullish.length,
        bearish: bearish.length,
        neutral: neutral.length,
        mixed: mixed.length,
      },
    };
  }

  classifyText(text: string): TriageResult {
    const symbols = this.extractSymbols(text);
    const stance = this.classifyStance(text);
    const tags = this.extractTags(text, symbols, stance);
    const snippet = this.evidenceSnippet(text);

    return {
      tags,
      mentions: symbols.map((symbol) => {
        const known = COMMON_SECURITIES[symbol];
        return {
          symbol,
          display_name: known?.displayName ?? null,
          asset_type: known?.assetType ?? null,
          sentiment: stance,
          stance,
          confidence: stance === "neutral" ? 0.55 : 0.7,
          evidence_snippet: snippet,
          source: "deterministic",
        };
      }),
    };
  }

  private shouldAiEnrich(result: TriageResult) {
    return (
      result.mentions.length > 0 ||
      result.tags.some(
        (tag) =>
          tag.tag_type === "subject" &&
          ["crypto", "equities", "macro", "options"].includes(tag.value),
      )
    );
  }

  private extractSymbols(text: string) {
    const symbols = new Set<string>();
    const cashtagRegex = /\$([A-Z]{1,8})(?![A-Z])/g;
    const upperText = text.toUpperCase();
    let match: RegExpExecArray | null;

    while ((match = cashtagRegex.exec(text)) !== null) {
      symbols.add(match[1]);
    }

    for (const symbol of Object.keys(COMMON_SECURITIES)) {
      const boundaryRegex = new RegExp(`\\b${symbol}\\b`, "i");
      if (boundaryRegex.test(text)) {
        symbols.add(symbol);
      }
    }

    for (const [alias, symbol] of Object.entries(COMPANY_ALIASES)) {
      if (new RegExp(`\\b${alias}\\b`, "i").test(text)) {
        symbols.add(symbol);
      }
    }

    if (/\bS\s*&\s*P\b/i.test(text) || upperText.includes("SP500")) {
      symbols.add("SPY");
    }

    return [...symbols].slice(0, 8);
  }

  private classifyStance(text: string) {
    const lower = text.toLowerCase();
    const bullScore = BULLISH_WORDS.reduce(
      (score, word) => score + (lower.includes(word) ? 1 : 0),
      0,
    );
    const bearScore = BEARISH_WORDS.reduce(
      (score, word) => score + (lower.includes(word) ? 1 : 0),
      0,
    );

    if (bullScore > 0 && bearScore > 0) return "mixed";
    if (bullScore > bearScore) return "bullish";
    if (bearScore > bullScore) return "bearish";
    return "neutral";
  }

  private extractTags(text: string, symbols: string[], stance: string) {
    const lower = text.toLowerCase();
    const tags: TriageResult["tags"] = [
      {
        tag_type: "sentiment",
        value: stance,
        confidence: stance === "neutral" ? 0.55 : 0.7,
        source: "deterministic",
      },
    ];

    for (const symbol of symbols) {
      tags.push({
        tag_type: "security",
        value: symbol,
        confidence: 0.8,
        source: "deterministic",
      });
    }

    const subjects = [
      ["crypto", ["btc", "eth", "crypto", "coin", "blockchain"]],
      ["equities", ["stock", "shares", "earnings", "calls", "puts"]],
      ["macro", ["fed", "inflation", "rates", "recession", "cpi"]],
      ["options", ["calls", "puts", "expiry", "strike", "iv"]],
    ] as const;

    for (const [subject, words] of subjects) {
      if (words.some((word) => lower.includes(word))) {
        tags.push({
          tag_type: "subject",
          value: subject,
          confidence: 0.7,
          source: "deterministic",
        });
      }
    }

    return tags;
  }

  private evidenceSnippet(text: string) {
    const compact = text.replace(/\s+/g, " ").trim();
    if (!compact) return null;
    return compact.length > 280 ? `${compact.slice(0, 277)}...` : compact;
  }

  private pickEvidence(
    mentions: Array<{
      evidence_snippet: string | null;
      confidence: number;
      post?: { clean_text: string };
    }>,
    fallback: string,
  ) {
    return mentions
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 4)
      .map(
        (mention) =>
          mention.evidence_snippet ??
          this.evidenceSnippet(mention.post?.clean_text ?? "") ??
          fallback,
      );
  }

  private cleanComment(html: string) {
    return this.decodeEntities(
      html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<a[^>]*class="quotelink"[^>]*>&gt;&gt;(\d+)<\/a>/gi, ">>$1")
        .replace(/<[^>]+>/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
    );
  }

  private decodeEntities(value: string) {
    return value
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
        String.fromCodePoint(Number.parseInt(hex, 16)),
      )
      .replace(/&#(\d+);/g, (_, num) =>
        String.fromCodePoint(Number.parseInt(num, 10)),
      )
      .replace(/&gt;/g, ">")
      .replace(/&lt;/g, "<")
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&amp;/g, "&");
  }

  private extractAttachment(post: FourChanPost): Prisma.InputJsonValue | null {
    if (!post.tim || !post.ext) {
      return null;
    }

    return {
      tim: post.tim,
      filename: post.filename ?? null,
      ext: post.ext,
      fsize: post.fsize ?? null,
      md5: post.md5 ?? null,
      width: post.w ?? null,
      height: post.h ?? null,
      thumbnail_width: post.tn_w ?? null,
      thumbnail_height: post.tn_h ?? null,
      file_deleted: post.filedeleted === 1,
      spoiler: post.spoiler === 1,
      media_url: `https://i.4cdn.org/biz/${post.tim}${post.ext}`,
      thumbnail_url: `https://i.4cdn.org/biz/${post.tim}s.jpg`,
    };
  }

  private parsePositiveInt(value: string | undefined, fallback: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.floor(parsed);
  }

  private throwIfShuttingDown() {
    if (this.isShuttingDown) {
      throw new Error("Shutdown requested");
    }
  }

  private async requeueTriageJobDuringShutdown(
    job: { id: string; post_id: string | null },
    message: string,
  ) {
    await this.prisma.biz_analysis_job
      .update({
        where: { id: job.id },
        data: {
          status: "queued",
          started_at: null,
          finished_at: null,
          error_message: message,
        },
      })
      .catch((error) => {
        this.logger.warn(
          `Failed to requeue triage job ${job.id} during shutdown: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });

    if (job.post_id) {
      await this.prisma.biz_post
        .update({
          where: { id: job.post_id },
          data: {
            analysis_state: "raw",
            analysis_error: null,
          },
        })
        .catch((error) => {
          this.logger.warn(
            `Failed to reset post ${job.post_id} during shutdown: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
    }
  }

  private async mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    mapper: (item: T) => Promise<R>,
  ) {
    const results: R[] = new Array(items.length);
    let nextIndex = 0;

    const workers = Array.from(
      { length: Math.min(concurrency, items.length) },
      async () => {
        while (nextIndex < items.length) {
          const currentIndex = nextIndex;
          nextIndex++;
          results[currentIndex] = await mapper(items[currentIndex]);
        }
      },
    );

    await Promise.all(workers);
    return results;
  }
}
