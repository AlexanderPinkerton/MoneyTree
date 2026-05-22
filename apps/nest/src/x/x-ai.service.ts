import { Injectable, Logger, OnApplicationShutdown } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";

import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";

type Sentiment = "bullish" | "bearish" | "neutral" | "mixed";

interface AiSecurity {
  symbol: string;
  display_name: string | null;
  asset_type: string | null;
  sentiment: Sentiment;
  stance: Sentiment;
  confidence: number;
  evidence_snippet: string | null;
}

interface AiTweetAnalysis {
  index: number;
  market_relevant: boolean;
  subject: string;
  sentiment: Sentiment;
  stance: Sentiment;
  confidence: number;
  summary: string;
  securities: AiSecurity[];
}

const BATCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["analyses"],
  properties: {
    analyses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "index",
          "market_relevant",
          "subject",
          "sentiment",
          "stance",
          "confidence",
          "summary",
          "securities",
        ],
        properties: {
          index: { type: "integer" },
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
      },
    },
  },
};

const AI_RUNNING_TIMEOUT_MS = 10 * 60 * 1000;
const ANALYSIS_VERSION = "x-tweet-v1";

@Injectable()
export class XAiService implements OnApplicationShutdown {
  private readonly logger = new Logger(XAiService.name);
  private readonly model =
    process.env.OPENAI_ANALYSIS_MODEL || "gpt-5-mini";
  private readonly batchSize = this.parsePositiveInt(
    process.env.X_ANALYSIS_BATCH_SIZE,
    20,
  );
  private isProcessing = false;
  private isPaused = false;
  private isShuttingDown = false;
  private readonly activeAbortControllers = new Set<AbortController>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  get enabled() {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  @Interval(8000)
  async processBacklog() {
    if (
      !this.enabled ||
      this.isProcessing ||
      this.isPaused ||
      this.isShuttingDown
    ) {
      return;
    }
    this.isProcessing = true;
    try {
      await this.processOneBatch();
    } catch (err) {
      this.logger.warn(
        `x AI batch failed: ${err instanceof Error ? err.message : err}`,
      );
    } finally {
      this.isProcessing = false;
    }
  }

  async onApplicationShutdown() {
    this.isShuttingDown = true;
    for (const ctrl of this.activeAbortControllers) ctrl.abort();
    this.activeAbortControllers.clear();
  }

  async pause() {
    this.isPaused = true;
    return { paused: true };
  }

  async resume() {
    this.isPaused = false;
    return { paused: false };
  }

  async status() {
    const [pending, analyzed, failed] = await Promise.all([
      this.prisma.x_tweet.count({ where: { analysis_state: "raw" } }),
      this.prisma.x_tweet.count({
        where: { analysis_state: "ai_analyzed" },
      }),
      this.prisma.x_tweet.count({ where: { analysis_state: "failed" } }),
    ]);
    return {
      enabled: this.enabled,
      isProcessing: this.isProcessing,
      isPaused: this.isPaused,
      pending,
      analyzed,
      failed,
      model: this.model,
      version: ANALYSIS_VERSION,
    };
  }

  async runOnce() {
    if (!this.enabled) {
      throw new Error("OpenAI API key not configured");
    }
    if (this.isProcessing) {
      return { skipped: true, reason: "already running" };
    }
    this.isProcessing = true;
    try {
      return await this.processOneBatch();
    } finally {
      this.isProcessing = false;
    }
  }

  private async processOneBatch() {
    const tweets = await this.prisma.x_tweet.findMany({
      where: { analysis_state: "raw" },
      orderBy: { posted_at: "desc" },
      take: this.batchSize,
    });
    if (tweets.length === 0) {
      return { processed: 0 };
    }

    // Mark as in-progress to avoid double processing
    await this.prisma.x_tweet.updateMany({
      where: { id: { in: tweets.map((t) => t.id) } },
      data: { analysis_state: "ai_running" },
    });

    let analyses: AiTweetAnalysis[] = [];
    try {
      analyses = await this.callOpenAi(tweets);
    } catch (err) {
      // Push back to raw so they get retried
      await this.prisma.x_tweet.updateMany({
        where: { id: { in: tweets.map((t) => t.id) } },
        data: {
          analysis_state: "failed",
          analysis_error:
            err instanceof Error ? err.message : "AI batch failed",
        },
      });
      throw err;
    }

    const byIndex = new Map<number, AiTweetAnalysis>();
    for (const a of analyses) byIndex.set(a.index, a);

    for (let i = 0; i < tweets.length; i += 1) {
      const tweet = tweets[i];
      const analysis = byIndex.get(i);
      if (!analysis) {
        await this.prisma.x_tweet.update({
          where: { id: tweet.id },
          data: {
            analysis_state: "failed",
            analysis_error: "AI did not return analysis for this index",
          },
        });
        continue;
      }
      await this.persistAnalysis(tweet, analysis);
    }

    this.realtime.broadcastXUpdate({
      type: "x_update",
      event: "ingest_progress",
      message: `Analyzed ${tweets.length} tweets`,
    });

    return { processed: tweets.length };
  }

  private async persistAnalysis(
    tweet: { id: string; tweet_id: string; handle: string; posted_at: Date },
    analysis: AiTweetAnalysis,
  ) {
    const ops: any[] = [
      this.prisma.x_tweet.update({
        where: { id: tweet.id },
        data: {
          analysis_state: "ai_analyzed",
          market_relevant: analysis.market_relevant,
          subject: analysis.subject,
          sentiment: analysis.sentiment,
          stance: analysis.stance,
          confidence: this.boundConfidence(analysis.confidence),
          summary: analysis.summary.slice(0, 240),
          analyzed_at: new Date(),
          analysis_model: this.model,
          analysis_version: ANALYSIS_VERSION,
          analysis_error: null,
        },
      }),
      this.prisma.x_security_mention.deleteMany({
        where: { tweet_id_db: tweet.id, source: "openai" },
      }),
    ];

    for (const sec of (analysis.securities ?? []).slice(0, 8)) {
      const symbol = sec.symbol?.trim().toUpperCase();
      if (!symbol) continue;
      ops.push(
        this.prisma.x_security_mention.create({
          data: {
            tweet_id_db: tweet.id,
            tweet_id: tweet.tweet_id,
            handle: tweet.handle,
            symbol,
            display_name: sec.display_name,
            asset_type: sec.asset_type,
            sentiment: sec.sentiment,
            stance: sec.stance,
            confidence: this.boundConfidence(sec.confidence),
            evidence_snippet: sec.evidence_snippet?.slice(0, 280) ?? null,
            source: "openai",
            posted_at: tweet.posted_at,
          },
        }),
      );
    }

    await this.prisma.$transaction(ops);
  }

  private async callOpenAi(
    tweets: Array<{ handle: string; text: string }>,
  ): Promise<AiTweetAnalysis[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    this.activeAbortControllers.add(controller);
    try {
      const lines = tweets
        .map(
          (t, i) =>
            `[${i}] @${t.handle}: ${t.text.replace(/\s+/g, " ").slice(0, 500)}`,
        )
        .join("\n");

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
                "You classify finance Twitter posts for research. Return only structured JSON. Each input tweet has an index in [N]. Return one analysis per index. Capture uncertainty: weak evidence = neutral or mixed. Extract real tickers/symbols (not generic words). Set market_relevant=false and securities=[] when there is no market content.",
            },
            {
              role: "user",
              content: `Analyze each tweet. Return analyses[] with one entry per input index. Tweets:\n\n${lines}`,
            },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "x_tweet_batch_analysis",
              strict: true,
              schema: BATCH_SCHEMA,
            },
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`OpenAI ${response.status}: ${body.slice(0, 500)}`);
      }

      const body = await response.json();
      const outputText = this.extractOutputText(body);
      if (!outputText) throw new Error("OpenAI response missing output text");
      const parsed = JSON.parse(outputText) as { analyses: AiTweetAnalysis[] };
      return parsed.analyses ?? [];
    } finally {
      clearTimeout(timeout);
      this.activeAbortControllers.delete(controller);
    }
  }

  private extractOutputText(response: any): string | null {
    if (typeof response.output_text === "string") return response.output_text;
    for (const item of response.output ?? []) {
      for (const content of item.content ?? []) {
        if (typeof content.text === "string") return content.text;
      }
    }
    return null;
  }

  private boundConfidence(value: number) {
    if (!Number.isFinite(value)) return 0.5;
    return Math.min(1, Math.max(0, value));
  }

  private parsePositiveInt(value: string | undefined, fallback: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.floor(parsed);
  }
}
