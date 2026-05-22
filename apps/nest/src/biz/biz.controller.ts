import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";

import { JwtAuthGuard } from "../auth/guards/jwt.auth.guard";
import { PrismaService } from "../prisma/prisma.service";
import { BizAiService } from "./biz-ai.service";
import { BizIngestService } from "./biz-ingest.service";
import { BizProcessingService } from "./biz-processing.service";

@Controller("biz")
@UseGuards(JwtAuthGuard)
export class BizController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingest: BizIngestService,
    private readonly processing: BizProcessingService,
    private readonly ai: BizAiService,
  ) {}

  @Get("threads")
  async getThreads(@Query("limit") limit = "80") {
    const take = this.parseTake(limit, 120);
    const threads = await this.prisma.biz_thread.findMany({
      orderBy: [
        { active: "desc" },
        { sticky: "desc" },
        { last_seen_at: "desc" },
      ],
      take,
      include: {
        _count: { select: { posts: true } },
        posts: {
          orderBy: { posted_at: "desc" },
          take: 1,
          select: { posted_at: true },
        },
      },
    });
    const opPosts = await this.prisma.biz_post.findMany({
      where: {
        is_op: true,
        thread_no: { in: threads.map((thread) => thread.thread_no) },
      },
      select: {
        thread_no: true,
        attachment: true,
      },
    });
    const attachmentsByThread = new Map(
      opPosts.map((post) => [post.thread_no, post.attachment]),
    );

    return threads.map((thread) => ({
      ...this.serializeDates(thread),
      post_count: thread._count.posts,
      latest_post_at: thread.posts[0]?.posted_at.toISOString() ?? null,
      attachment: thread.active
        ? (attachmentsByThread.get(thread.thread_no) ?? null)
        : null,
      _count: undefined,
      posts: undefined,
    }));
  }

  @Get("threads/:threadNo")
  async getThread(@Param("threadNo") threadNo: string) {
    const thread = await this.prisma.biz_thread.findUnique({
      where: { thread_no: Number(threadNo) },
    });

    if (!thread) {
      throw new NotFoundException("Thread not found");
    }

    const posts = await this.prisma.biz_post.findMany({
      where: { thread_no: Number(threadNo) },
      orderBy: { posted_at: "asc" },
      include: {
        tags: { orderBy: { created_at: "asc" } },
        security_mentions: { orderBy: { created_at: "asc" } },
      },
    });

    return {
      thread: this.serializeDates(thread),
      posts: posts.map((post) => this.mapPost(post)),
    };
  }

  @Get("feed")
  async getFeed(@Query("limit") limit = "160") {
    const take = this.parseTake(limit, 240);
    const posts = await this.prisma.biz_post.findMany({
      orderBy: { posted_at: "desc" },
      take,
      include: {
        thread: true,
        tags: { orderBy: { created_at: "asc" } },
        security_mentions: { orderBy: { created_at: "asc" } },
      },
    });

    return {
      posts: posts.map((post) => this.mapPost(post)),
      total: posts.length,
    };
  }

  @Get("posts/search")
  async searchPosts(
    @Query("q") q?: string,
    @Query("tag") tag?: string,
    @Query("symbol") symbol?: string,
    @Query("sentiment") sentiment?: string,
    @Query("analysis_state") analysisState?: string,
    @Query("limit") limit = "80",
  ) {
    return this.searchCorpus(q, tag, symbol, sentiment, analysisState, limit);
  }

  @Get("corpus/search")
  async searchCorpus(
    @Query("q") q?: string,
    @Query("tag") tag?: string,
    @Query("symbol") symbol?: string,
    @Query("sentiment") sentiment?: string,
    @Query("analysis_state") analysisState?: string,
    @Query("limit") limit = "80",
  ) {
    const take = this.parseTake(limit, 120);
    const where = this.buildPostWhere(q, tag, symbol, sentiment, analysisState);

    if (Object.keys(where).length === 0) {
      return { posts: [], total: 0 };
    }

    const [posts, total] = await this.prisma.$transaction([
      this.prisma.biz_post.findMany({
        where,
        orderBy: { posted_at: "desc" },
        take: Math.max(take * 3, take),
        include: {
          tags: { orderBy: { created_at: "asc" } },
          security_mentions: { orderBy: { created_at: "asc" } },
        },
      }),
      this.prisma.biz_post.count({ where }),
    ]);

    return {
      posts: posts
        .map((post) => ({
          post,
          score: this.scorePost(post, q, tag, symbol, sentiment, analysisState),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, take)
        .map(({ post }) => this.mapPost(post)),
      total,
    };
  }

  @Get("corpus/overview")
  async getCorpusOverview() {
    const [
      totalThreads,
      totalPosts,
      analysisGroups,
      stanceGroups,
      securityGroups,
      tagGroups,
      recentPosts,
    ] = await this.prisma.$transaction([
      this.prisma.biz_thread.count(),
      this.prisma.biz_post.count(),
      this.prisma.biz_post.groupBy({
        by: ["analysis_state"],
        _count: { _all: true },
        orderBy: { analysis_state: "asc" },
      }),
      this.prisma.biz_security_mention.groupBy({
        by: ["stance"],
        _count: { _all: true },
        orderBy: { stance: "asc" },
      }),
      this.prisma.biz_security_mention.groupBy({
        by: ["symbol"],
        _count: { _all: true },
        orderBy: { _count: { symbol: "desc" } },
        take: 20,
      }),
      this.prisma.biz_post_tag.groupBy({
        by: ["value"],
        where: { tag_type: { in: ["subject", "ai_tag", "security"] } },
        _count: { _all: true },
        orderBy: { _count: { value: "desc" } },
        take: 30,
      }),
      this.prisma.biz_post.findMany({
        orderBy: { posted_at: "desc" },
        take: 80,
        include: {
          thread: true,
          tags: { orderBy: { created_at: "asc" } },
          security_mentions: { orderBy: { created_at: "asc" } },
        },
      }),
    ]);

    return {
      generated_at: new Date().toISOString(),
      total_threads: totalThreads,
      total_posts: totalPosts,
      analysis_counts: this.countMap(analysisGroups, "analysis_state"),
      stance_counts: this.countMap(stanceGroups, "stance"),
      top_securities: securityGroups.map((group) =>
        this.term(group.symbol, this.groupCount(group)),
      ),
      top_tags: tagGroups.map((group) =>
        this.term(group.value, this.groupCount(group)),
      ),
      heatmap_terms: this.extractHeatmapTerms(recentPosts),
      recent_posts: recentPosts.slice(0, 20).map((post) => this.mapPost(post)),
    };
  }

  @Get("securities/:symbol/summary")
  async getSecuritySummary(@Param("symbol") symbol: string) {
    const normalizedSymbol = symbol.trim().toUpperCase();
    const mentions = await this.prisma.biz_security_mention.findMany({
      where: { symbol: { equals: normalizedSymbol, mode: "insensitive" } },
      orderBy: { created_at: "desc" },
      take: 120,
      include: {
        post: {
          select: {
            id: true,
            post_no: true,
            clean_text: true,
            posted_at: true,
            source_url: true,
          },
        },
      },
    });

    const summary = this.processing.buildSecuritySummary(
      normalizedSymbol,
      mentions,
    );

    return {
      symbol: normalizedSymbol,
      generated_at: new Date().toISOString(),
      total_mentions: mentions.length,
      bullish_count: summary.counts.bullish,
      bearish_count: summary.counts.bearish,
      neutral_count: summary.counts.neutral,
      mixed_count: summary.counts.mixed,
      summary: summary.summary,
      bullish_points: summary.bullishPoints,
      bearish_points: summary.bearishPoints,
      recent_mentions: mentions.slice(0, 30).map((mention) => ({
        ...this.serializeDates(mention),
        post_id: mention.post.id,
        post_no: mention.post.post_no,
        posted_at: mention.post.posted_at.toISOString(),
        post: undefined,
      })),
    };
  }

  @Get("ingest/status")
  async getIngestStatus() {
    const [
      latestRun,
      queuedJobs,
      failedJobs,
      queuedTriageJobs,
      completedTriageJobs,
      queuedAiJobs,
      completedAiJobs,
      skippedAiJobs,
      totalThreads,
      totalPosts,
      latest,
    ] = await this.prisma.$transaction([
      this.prisma.biz_ingest_run.findFirst({
        orderBy: { started_at: "desc" },
      }),
      this.prisma.biz_analysis_job.count({ where: { status: "queued" } }),
      this.prisma.biz_analysis_job.count({ where: { status: "failed" } }),
      this.prisma.biz_analysis_job.count({
        where: { stage: "triage", status: "queued" },
      }),
      this.prisma.biz_analysis_job.count({
        where: { stage: "triage", status: "completed" },
      }),
      this.prisma.biz_analysis_job.count({
        where: { stage: "ai_enrichment", status: "queued" },
      }),
      this.prisma.biz_analysis_job.count({
        where: { stage: "ai_enrichment", status: "completed" },
      }),
      this.prisma.biz_analysis_job.count({
        where: { stage: "ai_enrichment", status: "skipped" },
      }),
      this.prisma.biz_thread.count(),
      this.prisma.biz_post.count(),
      this.prisma.biz_post.findFirst({
        orderBy: { posted_at: "desc" },
        select: { posted_at: true },
      }),
    ]);

    return {
      latest_run: latestRun ? this.serializeDates(latestRun) : null,
      next_poll_hint_seconds: 300,
      queued_analysis_jobs: queuedJobs,
      failed_analysis_jobs: failedJobs,
      ai_enabled: this.ai.enabled,
      queued_triage_jobs: queuedTriageJobs,
      completed_triage_jobs: completedTriageJobs,
      queued_ai_jobs: queuedAiJobs,
      completed_ai_jobs: completedAiJobs,
      skipped_ai_jobs: skippedAiJobs,
      total_threads: totalThreads,
      total_posts: totalPosts,
      latest_post_at: latest?.posted_at.toISOString() ?? null,
    };
  }

  @Post("ingest/run")
  async runIngest() {
    void this.ingest.runIngest("manual").catch((error) => {
      console.error("Manual /biz/ ingest failed", error);
    });

    return {
      status: "started",
      message:
        "Ingest started in the background. Watch /biz/ingest/status or realtime events for progress.",
    };
  }

  @Post("analysis/requeue")
  async requeueAnalysis() {
    const posts = await this.prisma.biz_post.findMany({
      where: { analysis_state: { in: ["failed", "stale"] } },
      select: { id: true, thread_no: true },
      take: 200,
    });

    for (const post of posts) {
      await this.processing.enqueueAiEnrichment(post.id, post.thread_no);
    }

    return { requeued: posts.length };
  }

  @Get("analysis/status")
  async getAnalysisStatus() {
    const [triage, ai] = await Promise.all([
      this.processing.getStatus(),
      this.ai.getStatus(),
    ]);
    return this.combineAnalysisStatus(triage, ai);
  }

  @Post("analysis/start")
  async startAnalysis() {
    const [triage, ai] = await Promise.all([
      this.processing.start(),
      this.ai.start(),
    ]);
    return this.combineAnalysisStatus(triage, ai);
  }

  @Post("analysis/pause")
  async pauseAnalysis() {
    const [triage, ai] = await Promise.all([
      this.processing.pause(),
      this.ai.pause(),
    ]);
    return this.combineAnalysisStatus(triage, ai);
  }

  @Post("analysis/resume")
  async resumeAnalysis() {
    const [triage, ai] = await Promise.all([
      this.processing.resume(),
      this.ai.resume(),
    ]);
    return this.combineAnalysisStatus(triage, ai);
  }

  private parseTake(value: string, max: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return Math.min(80, max);
    return Math.min(Math.max(Math.floor(parsed), 1), max);
  }

  private mapPost(post: any) {
    return this.serializeDates({
      id: post.id,
      board: post.board,
      post_no: post.post_no,
      thread_no: post.thread_no,
      thread_subject: post.thread?.subject ?? null,
      thread_source_url: post.thread?.source_url ?? null,
      thread_active: post.thread?.active ?? null,
      is_op: post.is_op,
      subject: post.subject,
      author_name: post.author_name,
      poster_id: post.poster_id,
      posted_at: post.posted_at,
      source_url: post.source_url,
      clean_text: post.clean_text,
      attachment: post.attachment,
      analysis_state: post.analysis_state,
      triaged_at: post.triaged_at,
      ai_analyzed_at: post.ai_analyzed_at,
      analysis_model: post.analysis_model,
      analysis_version: post.analysis_version,
      analysis_error: post.analysis_error,
      analyzed_at: post.analyzed_at,
      first_seen_at: post.first_seen_at,
      updated_at: post.updated_at,
      tags: post.tags,
      security_mentions: post.security_mentions,
    });
  }

  private buildPostWhere(
    q?: string,
    tag?: string,
    symbol?: string,
    sentiment?: string,
    analysisState?: string,
  ) {
    const where: any = {};

    if (q?.trim()) {
      where.OR = [
        { clean_text: { contains: q.trim(), mode: "insensitive" } },
        { subject: { contains: q.trim(), mode: "insensitive" } },
        {
          tags: {
            some: { value: { contains: q.trim(), mode: "insensitive" } },
          },
        },
        {
          security_mentions: {
            some: { symbol: { contains: q.trim(), mode: "insensitive" } },
          },
        },
      ];
    }

    if (tag?.trim()) {
      where.tags = {
        some: {
          value: { equals: tag.trim(), mode: "insensitive" },
        },
      };
    }

    if (symbol?.trim()) {
      where.security_mentions = {
        some: {
          symbol: { equals: symbol.trim().toUpperCase(), mode: "insensitive" },
        },
      };
    }

    if (sentiment?.trim()) {
      where.security_mentions = {
        ...(where.security_mentions ?? {}),
        some: {
          ...((where.security_mentions?.some as object) ?? {}),
          stance: { equals: sentiment.trim().toLowerCase() },
        },
      };
    }

    if (analysisState?.trim()) {
      where.analysis_state = analysisState.trim();
    }

    return where;
  }

  private scorePost(
    post: any,
    q?: string,
    tag?: string,
    symbol?: string,
    sentiment?: string,
    analysisState?: string,
  ) {
    let score = 0;
    const query = q?.trim().toLowerCase();
    const text = `${post.subject ?? ""} ${post.clean_text}`.toLowerCase();

    if (query && text.includes(query)) score += 10;
    if (
      query &&
      post.tags?.some((postTag: any) => postTag.value.toLowerCase() === query)
    ) {
      score += 15;
    }
    if (
      query &&
      post.security_mentions?.some(
        (mention: any) => mention.symbol.toLowerCase() === query,
      )
    ) {
      score += 20;
    }
    if (
      tag?.trim() &&
      post.tags?.some(
        (postTag: any) =>
          postTag.value.toLowerCase() === tag.trim().toLowerCase(),
      )
    ) {
      score += 12;
    }
    if (
      symbol?.trim() &&
      post.security_mentions?.some(
        (mention: any) =>
          mention.symbol.toLowerCase() === symbol.trim().toLowerCase(),
      )
    ) {
      score += 18;
    }
    if (
      sentiment?.trim() &&
      post.security_mentions?.some(
        (mention: any) => mention.stance === sentiment.trim().toLowerCase(),
      )
    ) {
      score += 8;
    }
    if (analysisState?.trim() && post.analysis_state === analysisState.trim()) {
      score += 4;
    }

    const confidence =
      post.security_mentions?.reduce(
        (max: number, mention: any) => Math.max(max, mention.confidence ?? 0),
        0,
      ) ?? 0;
    score += confidence * 5;
    score += Math.max(
      0,
      5 - (Date.now() - post.posted_at.getTime()) / 86400000,
    );

    return score;
  }

  private countMap<T extends Record<string, any>>(groups: T[], key: string) {
    return Object.fromEntries(
      groups.map((group) => [group[key], this.groupCount(group)]),
    );
  }

  private groupCount(group: any) {
    return Number(group?._count?._all ?? 0);
  }

  private term(value: string, count: number) {
    return { value, count, weight: count };
  }

  private combineAnalysisStatus(triage: any, ai: any) {
    const totalWork =
      triage.queued +
      triage.running_jobs +
      triage.completed +
      triage.failed +
      ai.queued +
      ai.running_jobs +
      ai.completed +
      ai.failed;
    const completedWork = triage.completed + ai.completed;

    return {
      ...ai,
      running: triage.running || ai.running,
      paused: triage.paused || ai.paused,
      triage_running: triage.running,
      triage_paused: triage.paused,
      triage_batch_size: triage.batch_size,
      triage_concurrency: triage.concurrency,
      ai_batch_size: ai.batch_size,
      ai_concurrency: ai.concurrency,
      queued_triage: triage.queued,
      running_triage_jobs: triage.running_jobs,
      completed_triage: triage.completed,
      failed_triage: triage.failed,
      progress_percent:
        totalWork > 0 ? Math.round((completedWork / totalWork) * 100) : 0,
      current_message:
        triage.paused && ai.paused
          ? "Analysis paused"
          : triage.running
            ? "Triage running"
            : ai.running
              ? "AI enrichment running"
              : triage.queued > 0
                ? "Triage queued"
                : ai.queued > 0
                  ? "AI enrichment queued"
                  : "Analysis idle",
    };
  }

  private extractHeatmapTerms(posts: Array<{ clean_text: string }>) {
    const stop = new Set([
      "the",
      "and",
      "for",
      "you",
      "are",
      "but",
      "with",
      "this",
      "that",
      "have",
      "from",
      "will",
      "just",
      "your",
      "they",
      "what",
      "when",
      "where",
      "money",
      "anon",
    ]);
    const counts = new Map<string, number>();

    for (const post of posts) {
      for (const word of post.clean_text
        .toLowerCase()
        .match(/\b[a-z0-9$]{3,16}\b/g) ?? []) {
        if (stop.has(word)) continue;
        counts.set(word, (counts.get(word) ?? 0) + 1);
      }
    }

    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([value, count]) => this.term(value, count));
  }

  private serializeDates<T extends Record<string, any>>(value: T): T {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [
          key,
          entry instanceof Date ? entry.toISOString() : entry,
        ]),
    ) as T;
  }
}
