import { Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";

type WindowKey = "1d" | "7d" | "30d" | "90d" | "all";

const WINDOW_DAYS: Record<WindowKey, number | null> = {
  "1d": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: null,
};

function parseWindow(value: string | undefined): WindowKey {
  if (value && value in WINDOW_DAYS) return value as WindowKey;
  return "7d";
}

function windowSince(window: WindowKey) {
  const days = WINDOW_DAYS[window];
  if (days == null) return null;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

@Injectable()
export class XSentimentService {
  constructor(private readonly prisma: PrismaService) {}

  async tickerOverview(opts: {
    window?: string;
    handle?: string;
    limit?: number;
  }) {
    const window = parseWindow(opts.window);
    const since = windowSince(window);
    const limit = Math.min(Math.max(opts.limit ?? 25, 1), 200);

    const where: any = { source: "openai" };
    if (since) where.posted_at = { gte: since };
    if (opts.handle) where.handle = opts.handle;

    const rows = await this.prisma.x_security_mention.groupBy({
      by: ["symbol", "stance"],
      where,
      _count: true,
      _avg: { confidence: true },
    });

    const byTicker = new Map<
      string,
      {
        symbol: string;
        total: number;
        bullish: number;
        bearish: number;
        neutral: number;
        mixed: number;
        avg_confidence: number;
      }
    >();
    for (const row of rows) {
      const count = Number((row as any)._count ?? 0);
      const cur = byTicker.get(row.symbol) ?? {
        symbol: row.symbol,
        total: 0,
        bullish: 0,
        bearish: 0,
        neutral: 0,
        mixed: 0,
        avg_confidence: 0,
      };
      cur.total += count;
      cur.avg_confidence += (row._avg.confidence ?? 0) * count;
      switch (row.stance) {
        case "bullish":
          cur.bullish += count;
          break;
        case "bearish":
          cur.bearish += count;
          break;
        case "neutral":
          cur.neutral += count;
          break;
        case "mixed":
          cur.mixed += count;
          break;
      }
      byTicker.set(row.symbol, cur);
    }

    const tickers = [...byTicker.values()]
      .map((t) => ({
        ...t,
        avg_confidence: t.total > 0 ? t.avg_confidence / t.total : 0,
        net: t.bullish - t.bearish,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, limit);

    // Overall sentiment from x_tweet
    const tweetWhere: any = {
      analysis_state: "ai_analyzed",
      market_relevant: true,
    };
    if (since) tweetWhere.posted_at = { gte: since };
    if (opts.handle) tweetWhere.handle = opts.handle;
    const sentimentGroup = await this.prisma.x_tweet.groupBy({
      by: ["sentiment"],
      where: tweetWhere,
      _count: true,
    });
    const sentimentCounts = {
      bullish: 0,
      bearish: 0,
      neutral: 0,
      mixed: 0,
      total: 0,
    };
    for (const row of sentimentGroup as Array<{ sentiment: string | null; _count: number }>) {
      const count = Number((row as any)._count ?? 0);
      const k = row.sentiment as keyof typeof sentimentCounts | null;
      if (k && k !== "total" && k in sentimentCounts) {
        sentimentCounts[k] += count;
      }
      sentimentCounts.total += count;
    }

    return {
      window,
      since: since?.toISOString() ?? null,
      handle: opts.handle ?? null,
      tweet_sentiment: sentimentCounts,
      tickers,
    };
  }

  async tickerDetail(symbol: string, opts: { window?: string }) {
    const window = parseWindow(opts.window);
    const since = windowSince(window);
    const symU = symbol.trim().toUpperCase();

    const where: any = { symbol: symU, source: "openai" };
    if (since) where.posted_at = { gte: since };

    const [mentions, total] = await Promise.all([
      this.prisma.x_security_mention.findMany({
        where,
        orderBy: { posted_at: "desc" },
        take: 50,
        include: {
          tweet: {
            select: {
              text: true,
              url: true,
              likes: true,
              retweets: true,
              replies: true,
              posted_at: true,
              handle: true,
            },
          },
        },
      }),
      this.prisma.x_security_mention.count({ where }),
    ]);

    return { symbol: symU, window, total, mentions };
  }
}
