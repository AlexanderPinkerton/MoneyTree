import { Injectable, Logger, OnApplicationShutdown } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";

import { PrismaService } from "../prisma/prisma.service";

type AiSecurity = {
  symbol: string;
  display_name: string | null;
  asset_type: string | null;
  sentiment: "bullish" | "bearish" | "neutral" | "mixed";
  stance: "bullish" | "bearish" | "neutral" | "mixed";
  confidence: number;
  evidence_snippet: string | null;
};

type AiPostAnalysis = {
  market_relevant: boolean;
  subject: string;
  sentiment: "bullish" | "bearish" | "neutral" | "mixed";
  stance: "bullish" | "bearish" | "neutral" | "mixed";
  confidence: number;
  summary: string;
  tags: string[];
  securities: AiSecurity[];
};

const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "market_relevant",
    "subject",
    "sentiment",
    "stance",
    "confidence",
    "summary",
    "tags",
    "securities",
  ],
  properties: {
    market_relevant: { type: "boolean" },
    subject: {
      type: "string",
      enum: [
        "crypto",
        "equities",
        "macro",
        "options",
        "commodities",
        "forex",
        "other",
        "not_market_relevant",
      ],
    },
    sentiment: {
      type: "string",
      enum: ["bullish", "bearish", "neutral", "mixed"],
    },
    stance: {
      type: "string",
      enum: ["bullish", "bearish", "neutral", "mixed"],
    },
    confidence: { type: "number" },
    summary: { type: "string" },
    tags: {
      type: "array",
      items: { type: "string" },
    },
    securities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "symbol",
          "display_name",
          "asset_type",
          "sentiment",
          "stance",
          "confidence",
          "evidence_snippet",
        ],
        properties: {
          symbol: { type: "string" },
          display_name: {
            anyOf: [{ type: "string" }, { type: "null" }],
          },
          asset_type: {
            anyOf: [
              {
                type: "string",
                enum: [
                  "equity",
                  "crypto",
                  "etf",
                  "index",
                  "commodity",
                  "forex",
                  "other",
                ],
              },
              { type: "null" },
            ],
          },
          sentiment: {
            type: "string",
            enum: ["bullish", "bearish", "neutral", "mixed"],
          },
          stance: {
            type: "string",
            enum: ["bullish", "bearish", "neutral", "mixed"],
          },
          confidence: { type: "number" },
          evidence_snippet: {
            anyOf: [{ type: "string" }, { type: "null" }],
          },
        },
      },
    },
  },
};

const AI_RUNNING_TIMEOUT_MS = 15 * 60 * 1000;

@Injectable()
export class BizAiService implements OnApplicationShutdown {
  private readonly logger = new Logger(BizAiService.name);
  private readonly model = process.env.OPENAI_ANALYSIS_MODEL || "gpt-5-mini";
  private readonly analysisVersion = "biz-post-v2";
  private readonly batchSize = this.parsePositiveInt(
    process.env.OPENAI_ANALYSIS_BATCH_SIZE,
    60,
  );
  private readonly concurrency = this.parsePositiveInt(
    process.env.OPENAI_ANALYSIS_CONCURRENCY,
    6,
  );
  private isProcessing = false;
  private isPaused = false;
  private isShuttingDown = false;
  private readonly activeAbortControllers = new Set<AbortController>();

  constructor(private readonly prisma: PrismaService) {}

  get enabled() {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  @Interval(5000)
  async processBacklog() {
    if (this.isPaused || this.isShuttingDown) {
      this.logger.debug("AI enrichment is paused; skipping tick");
      return;
    }
    await this.processQueuedAiEnrichment();
  }

  onApplicationShutdown(signal?: string) {
    this.isShuttingDown = true;
    this.isPaused = true;
    this.logger.warn(
      `Stopping AI enrichment${signal ? ` after ${signal}` : ""}`,
    );
    for (const controller of this.activeAbortControllers) {
      controller.abort();
    }
  }

  async processQueuedAiEnrichment(limit = this.batchSize) {
    if (this.isPaused || this.isShuttingDown) {
      this.logger.debug("AI enrichment is paused; skipping tick");
      return { completed: 0, skipped: 0, failed: 0 };
    }

    if (this.isProcessing) {
      this.logger.debug("AI enrichment is already processing; skipping tick");
      return { completed: 0, skipped: 0, failed: 0 };
    }

    if (!this.enabled) {
      const skipped = await this.prisma.biz_analysis_job.count({
        where: { stage: "ai_enrichment", status: "queued" },
      });

      if (skipped > 0) {
        this.logger.warn(
          `Leaving ${skipped} AI enrichment jobs queued; OPENAI_API_KEY is missing`,
        );
      }
      return { completed: 0, skipped, failed: 0 };
    }

    this.isProcessing = true;

    try {
      let completed = 0;
      let failed = 0;

      while (!this.isPaused && !this.isShuttingDown) {
        await this.requeueStaleRunningJobs();

        const jobs = await this.prisma.biz_analysis_job.findMany({
          where: { stage: "ai_enrichment", status: "queued" },
          orderBy: { created_at: "asc" },
          take: limit,
        });

        if (jobs.length === 0) {
          break;
        }

        this.logger.log(
          `Processing ${jobs.length} AI enrichment jobs with concurrency ${this.concurrency}`,
        );

        const results = await this.mapWithConcurrency(
          jobs,
          this.concurrency,
          async (job) => this.processJob(job),
        );

        completed += results.filter((result) => result === "completed").length;
        failed += results.filter((result) => result === "failed").length;
      }

      return { completed, skipped: 0, failed };
    } finally {
      this.isProcessing = false;
    }
  }

  async start(limit = this.batchSize) {
    if (this.isShuttingDown) {
      return this.getStatus();
    }

    this.isPaused = false;
    void this.processQueuedAiEnrichment(limit).catch((error) => {
      this.logger.warn(
        `Manual AI enrichment failed: ${
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
    return this.start();
  }

  async getStatus() {
    const [
      queued,
      runningJobs,
      completed,
      failed,
      skipped,
      analyzablePosts,
      analyzedPosts,
      lastStarted,
      lastFinished,
    ] = await this.prisma.$transaction([
      this.prisma.biz_analysis_job.count({
        where: { stage: "ai_enrichment", status: "queued" },
      }),
      this.prisma.biz_analysis_job.count({
        where: { stage: "ai_enrichment", status: "running" },
      }),
      this.prisma.biz_analysis_job.count({
        where: { stage: "ai_enrichment", status: "completed" },
      }),
      this.prisma.biz_analysis_job.count({
        where: { stage: "ai_enrichment", status: "failed" },
      }),
      this.prisma.biz_analysis_job.count({
        where: { stage: "ai_enrichment", status: "skipped" },
      }),
      this.prisma.biz_post.count({
        where: {
          analysis_state: {
            in: ["ai_queued", "ai_analyzed", "failed", "stale"],
          },
        },
      }),
      this.prisma.biz_post.count({
        where: { analysis_state: "ai_analyzed" },
      }),
      this.prisma.biz_analysis_job.findFirst({
        where: { stage: "ai_enrichment", started_at: { not: null } },
        orderBy: { started_at: "desc" },
        select: { started_at: true },
      }),
      this.prisma.biz_analysis_job.findFirst({
        where: { stage: "ai_enrichment", finished_at: { not: null } },
        orderBy: { finished_at: "desc" },
        select: { finished_at: true },
      }),
    ]);
    const denominator = Math.max(
      analyzablePosts,
      analyzedPosts + queued + runningJobs + failed,
    );
    const progressPercent =
      denominator > 0 ? Math.round((analyzedPosts / denominator) * 100) : 0;

    return {
      ai_enabled: this.enabled,
      running: this.isProcessing || runningJobs > 0,
      paused: this.isPaused,
      batch_size: this.batchSize,
      concurrency: this.concurrency,
      queued,
      running_jobs: runningJobs,
      completed,
      failed,
      skipped,
      analyzable_posts: analyzablePosts,
      analyzed_posts: analyzedPosts,
      progress_percent: progressPercent,
      last_started_at: lastStarted?.started_at?.toISOString() ?? null,
      last_finished_at: lastFinished?.finished_at?.toISOString() ?? null,
      current_message: this.isPaused
        ? "Analysis paused"
        : this.isProcessing || runningJobs > 0
          ? "Analysis running"
          : queued > 0
            ? "Analysis queued"
            : "Analysis idle",
    };
  }

  private async processJob(job: {
    id: string;
    post_id: string | null;
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
      if (!job.post_id) {
        throw new Error("AI enrichment job is missing post_id");
      }

      await this.enrichPost(job.post_id);
      await this.prisma.biz_analysis_job.update({
        where: { id: job.id },
        data: { status: "completed", finished_at: new Date() },
      });
      return "completed";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`AI enrichment job ${job.id} failed: ${message}`);
      if (this.isShuttingDown) {
        await this.requeueJobDuringShutdown(job, message);
        return "failed";
      }

      if (job.post_id) {
        await this.prisma.biz_post.update({
          where: { id: job.post_id },
          data: {
            analysis_state: "failed",
            analysis_error: message,
          },
        });
      }
      await this.prisma.biz_analysis_job.update({
        where: { id: job.id },
        data: {
          status: "failed",
          error_message: message,
          finished_at: new Date(),
        },
      });
      return "failed";
    }
  }

  private async requeueStaleRunningJobs() {
    await this.prisma.biz_analysis_job.updateMany({
      where: {
        stage: "ai_enrichment",
        status: "running",
        started_at: {
          lt: new Date(Date.now() - AI_RUNNING_TIMEOUT_MS),
        },
      },
      data: {
        status: "queued",
        started_at: null,
        error_message: "Requeued stale running AI job",
      },
    });
  }

  private async enrichPost(postId: string) {
    this.throwIfShuttingDown();
    const post = await this.prisma.biz_post.findUnique({
      where: { id: postId },
      include: {
        thread: true,
        tags: true,
        security_mentions: true,
      },
    });

    if (!post) {
      throw new Error(`Post ${postId} not found`);
    }

    const analysis = await this.callOpenAi(post);
    this.throwIfShuttingDown();

    await this.prisma.$transaction([
      this.prisma.biz_post_tag.upsert({
        where: {
          post_id_tag_type_value_source: {
            post_id: post.id,
            tag_type: "subject",
            value: analysis.subject,
            source: "openai",
          },
        },
        update: { confidence: analysis.confidence },
        create: {
          post_id: post.id,
          tag_type: "subject",
          value: analysis.subject,
          confidence: analysis.confidence,
          source: "openai",
        },
      }),
      this.prisma.biz_post_tag.upsert({
        where: {
          post_id_tag_type_value_source: {
            post_id: post.id,
            tag_type: "sentiment",
            value: analysis.sentiment,
            source: "openai",
          },
        },
        update: { confidence: analysis.confidence },
        create: {
          post_id: post.id,
          tag_type: "sentiment",
          value: analysis.sentiment,
          confidence: analysis.confidence,
          source: "openai",
        },
      }),
      this.prisma.biz_post_tag.upsert({
        where: {
          post_id_tag_type_value_source: {
            post_id: post.id,
            tag_type: "ai_summary",
            value: this.trimForTag(analysis.summary),
            source: "openai",
          },
        },
        update: { confidence: analysis.confidence },
        create: {
          post_id: post.id,
          tag_type: "ai_summary",
          value: this.trimForTag(analysis.summary),
          confidence: analysis.confidence,
          source: "openai",
        },
      }),
      ...analysis.tags.slice(0, 8).map((tag) =>
        this.prisma.biz_post_tag.upsert({
          where: {
            post_id_tag_type_value_source: {
              post_id: post.id,
              tag_type: "ai_tag",
              value: this.normalizeTag(tag),
              source: "openai",
            },
          },
          update: { confidence: analysis.confidence },
          create: {
            post_id: post.id,
            tag_type: "ai_tag",
            value: this.normalizeTag(tag),
            confidence: analysis.confidence,
            source: "openai",
          },
        }),
      ),
      ...analysis.securities.slice(0, 8).map((security) =>
        this.prisma.biz_security_mention.upsert({
          where: {
            post_id_symbol_source: {
              post_id: post.id,
              symbol: security.symbol.toUpperCase(),
              source: "openai",
            },
          },
          update: {
            display_name: security.display_name,
            asset_type: security.asset_type,
            sentiment: security.sentiment,
            stance: security.stance,
            confidence: this.boundConfidence(security.confidence),
            evidence_snippet: security.evidence_snippet,
          },
          create: {
            post_id: post.id,
            thread_no: post.thread_no,
            symbol: security.symbol.toUpperCase(),
            display_name: security.display_name,
            asset_type: security.asset_type,
            sentiment: security.sentiment,
            stance: security.stance,
            confidence: this.boundConfidence(security.confidence),
            evidence_snippet: security.evidence_snippet,
            source: "openai",
          },
        }),
      ),
      this.prisma.biz_post.update({
        where: { id: post.id },
        data: {
          analysis_state: "ai_analyzed",
          ai_analyzed_at: new Date(),
          analyzed_at: new Date(),
          analysis_model: this.model,
          analysis_version: this.analysisVersion,
          analysis_error: null,
        },
      }),
    ]);
  }

  private async callOpenAi(post: {
    post_no: number;
    thread_no: number;
    subject: string | null;
    clean_text: string;
    thread: { subject: string | null };
    tags: Array<{ tag_type: string; value: string }>;
    security_mentions: Array<{ symbol: string; stance: string }>;
  }): Promise<AiPostAnalysis> {
    this.throwIfShuttingDown();
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 30000);
    this.activeAbortControllers.add(abortController);

    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          input: [
            {
              role: "system",
              content:
                "You classify anonymous finance forum posts for research organization. Return only structured JSON. Do not give investment advice. Capture uncertainty and mark weak evidence neutral or mixed.",
            },
            {
              role: "user",
              content: this.buildPrompt(post),
            },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "biz_post_analysis",
              strict: true,
              schema: ANALYSIS_SCHEMA,
            },
          },
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`OpenAI ${response.status}: ${body.slice(0, 500)}`);
      }

      const body = await response.json();
      const outputText = this.extractOutputText(body);
      if (!outputText) {
        throw new Error("OpenAI response did not include output text");
      }

      return JSON.parse(outputText) as AiPostAnalysis;
    } catch (error) {
      if (this.isShuttingDown) {
        throw new Error("Shutdown requested");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      this.activeAbortControllers.delete(abortController);
    }
  }

  private buildPrompt(post: {
    post_no: number;
    thread_no: number;
    subject: string | null;
    clean_text: string;
    thread: { subject: string | null };
    tags: Array<{ tag_type: string; value: string }>;
    security_mentions: Array<{ symbol: string; stance: string }>;
  }) {
    const deterministicTags = post.tags
      .map((tag) => `${tag.tag_type}:${tag.value}`)
      .join(", ");
    const deterministicMentions = post.security_mentions
      .map((mention) => `${mention.symbol}:${mention.stance}`)
      .join(", ");

    return [
      `Thread: ${post.thread_no}`,
      `Post: ${post.post_no}`,
      `Thread subject: ${post.thread.subject ?? "none"}`,
      `Post subject: ${post.subject ?? "none"}`,
      `Deterministic tags: ${deterministicTags || "none"}`,
      `Deterministic securities: ${deterministicMentions || "none"}`,
      "Post text:",
      post.clean_text.slice(0, 4000),
      "",
      "Classify securities actually discussed in the post. Use ticker symbols when clear. If no market/security discussion is present, market_relevant=false and securities=[].",
    ].join("\n");
  }

  private extractOutputText(response: any) {
    if (typeof response.output_text === "string") {
      return response.output_text;
    }

    for (const item of response.output ?? []) {
      for (const content of item.content ?? []) {
        if (typeof content.text === "string") {
          return content.text;
        }
      }
    }

    return null;
  }

  private normalizeTag(tag: string) {
    return tag.trim().toLowerCase().replace(/\s+/g, "_").slice(0, 80);
  }

  private trimForTag(value: string) {
    return value.trim().replace(/\s+/g, " ").slice(0, 180);
  }

  private boundConfidence(value: number) {
    if (!Number.isFinite(value)) return 0.5;
    return Math.min(1, Math.max(0, value));
  }

  private parsePositiveInt(value: string | undefined, fallback: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return fallback;
    }
    return Math.floor(parsed);
  }

  private throwIfShuttingDown() {
    if (this.isShuttingDown) {
      throw new Error("Shutdown requested");
    }
  }

  private async requeueJobDuringShutdown(
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
          `Failed to requeue AI job ${job.id} during shutdown: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });

    if (job.post_id) {
      await this.prisma.biz_post
        .update({
          where: { id: job.post_id },
          data: {
            analysis_state: "ai_queued",
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
