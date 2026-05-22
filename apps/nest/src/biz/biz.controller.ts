import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";

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
          select: { post_no: true, posted_at: true },
        },
      },
    });
    const threadPosts = await this.prisma.biz_post.findMany({
      where: {
        thread_no: { in: threads.map((thread) => thread.thread_no) },
      },
      select: {
        thread_no: true,
        post_no: true,
        first_seen_at: true,
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
    const postsByThread = new Map<
      number,
      Array<{ post_no: number; first_seen_at: Date }>
    >();
    for (const post of threadPosts) {
      const posts = postsByThread.get(post.thread_no) ?? [];
      posts.push({
        post_no: post.post_no,
        first_seen_at: post.first_seen_at,
      });
      postsByThread.set(post.thread_no, posts);
    }

    return threads.map((thread) => ({
      ...this.serializeDates(thread),
      post_count: thread._count.posts,
      latest_post_at: thread.posts[0]?.posted_at.toISOString() ?? null,
      latest_post_no: thread.posts[0]?.post_no ?? null,
      post_nos:
        postsByThread.get(thread.thread_no)?.map((post) => post.post_no) ?? [],
      post_refs:
        postsByThread.get(thread.thread_no)?.map((post) => ({
          post_no: post.post_no,
          first_seen_at: post.first_seen_at.toISOString(),
        })) ?? [],
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
    const recentWindowStartedAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    let windowLabel = "Recent 24h";
    let windowStartedAt: Date | null = recentWindowStartedAt;
    let recentPosts = await this.prisma.biz_post.findMany({
      where: { posted_at: { gte: recentWindowStartedAt } },
      orderBy: { posted_at: "desc" },
      take: 500,
      include: {
        thread: true,
        tags: { orderBy: { created_at: "asc" } },
        security_mentions: { orderBy: { created_at: "asc" } },
      },
    });

    if (recentPosts.length < 25) {
      windowLabel = "Latest 500 posts";
      windowStartedAt = null;
      recentPosts = await this.prisma.biz_post.findMany({
        orderBy: { posted_at: "desc" },
        take: 500,
        include: {
          thread: true,
          tags: { orderBy: { created_at: "asc" } },
          security_mentions: { orderBy: { created_at: "asc" } },
        },
      });
    }

    const analysisCounts = this.countBy(recentPosts, "analysis_state");
    const stanceCounts = this.countMentionStances(recentPosts);
    const termBlacklist = await this.getTermBlacklistEntries();
    const blacklistedTerms = new Set(
      termBlacklist.map((entry) => entry.normalized_term),
    );
    const trendingSecurities = this.extractTrendingSecurities(recentPosts);
    const topSubjects = this.applyTermBlacklist(
      this.extractTopSubjects(recentPosts),
      blacklistedTerms,
    );
    const topTags = this.applyTermBlacklist(
      this.extractTopTags(recentPosts),
      blacklistedTerms,
    );
    const terminologyTerms = this.extractTerminologyTerms(
      recentPosts,
      this.buildStructuredTermExclusions(recentPosts, blacklistedTerms),
    );
    const evidencePosts = this.pickSignalEvidencePosts(recentPosts);

    return {
      generated_at: new Date().toISOString(),
      window_label: windowLabel,
      window_started_at: windowStartedAt?.toISOString() ?? null,
      total_threads: new Set(recentPosts.map((post) => post.thread_no)).size,
      total_posts: recentPosts.length,
      analysis_counts: analysisCounts,
      stance_counts: stanceCounts,
      top_securities: trendingSecurities
        .slice(0, 20)
        .map((security) =>
          this.term(
            security.symbol,
            security.count,
            security.weight,
            "security",
          ),
        ),
      top_tags: topTags,
      top_subjects: topSubjects,
      signal_terms: terminologyTerms,
      term_blacklist: termBlacklist,
      trending_securities: trendingSecurities,
      heatmap_terms: terminologyTerms,
      recent_posts: evidencePosts
        .slice(0, 20)
        .map((post) => this.mapPost(post)),
    };
  }

  @Get("corpus/term-blacklist")
  async getTermBlacklist() {
    return this.getTermBlacklistEntries();
  }

  @Post("corpus/term-blacklist")
  async addTermBlacklist(@Body() body: { term?: string }) {
    const term = body.term?.trim();
    const normalizedTerm = this.normalizeSignalTerm(term ?? "");
    if (!term || !normalizedTerm || this.isNoiseTerm(normalizedTerm)) {
      throw new BadRequestException("Blacklist term is empty or invalid");
    }

    await this.prisma.$executeRaw`
      INSERT INTO "biz_term_blacklist" ("id", "term", "normalized_term", "updated_at")
      VALUES (${randomUUID()}, ${term}, ${normalizedTerm}, CURRENT_TIMESTAMP)
      ON CONFLICT ("normalized_term") DO UPDATE
      SET "term" = EXCLUDED."term", "updated_at" = CURRENT_TIMESTAMP
    `;

    return this.getTermBlacklistEntries();
  }

  @Post("corpus/term-blacklist/remove")
  async removeTermBlacklist(@Body() body: { term?: string }) {
    const normalizedTerm = this.normalizeSignalTerm(body.term ?? "");
    if (!normalizedTerm) {
      throw new BadRequestException("Blacklist term is empty");
    }

    await this.prisma.$executeRaw`
      DELETE FROM "biz_term_blacklist"
      WHERE "normalized_term" = ${normalizedTerm}
    `;

    return this.getTermBlacklistEntries();
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

  private term(value: string, count: number, weight = count, kind?: string) {
    return { value, count, weight, kind };
  }

  private async getTermBlacklistEntries() {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        term: string;
        normalized_term: string;
        created_at: Date;
        updated_at: Date;
      }>
    >`
      SELECT "id", "term", "normalized_term", "created_at", "updated_at"
      FROM "biz_term_blacklist"
      ORDER BY "created_at" DESC
    `;

    return rows.map((row) => ({
      ...row,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    }));
  }

  private applyTermBlacklist<T extends { value: string }>(
    terms: T[],
    blacklistedTerms: Set<string>,
  ) {
    if (blacklistedTerms.size === 0) return terms;
    return terms.filter(
      (term) => !blacklistedTerms.has(this.normalizeSignalTerm(term.value)),
    );
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

  private countBy(posts: any[], key: string) {
    const counts: Record<string, number> = {};
    for (const post of posts) {
      const value = post[key] ?? "unknown";
      counts[value] = (counts[value] ?? 0) + 1;
    }
    return counts;
  }

  private countMentionStances(posts: any[]) {
    const counts: Record<string, number> = {
      bullish: 0,
      bearish: 0,
      neutral: 0,
      mixed: 0,
    };

    for (const post of posts) {
      for (const mention of post.security_mentions ?? []) {
        counts[mention.stance] = (counts[mention.stance] ?? 0) + 1;
      }
    }

    return counts;
  }

  private extractTrendingSecurities(posts: any[]) {
    const securities = new Map<
      string,
      {
        symbol: string;
        count: number;
        bullish: number;
        bearish: number;
        neutral: number;
        mixed: number;
        threads: Set<number>;
      }
    >();

    for (const post of posts) {
      for (const mention of post.security_mentions ?? []) {
        const symbol = String(mention.symbol ?? "").toUpperCase();
        if (!symbol) continue;
        const current = securities.get(symbol) ?? {
          symbol,
          count: 0,
          bullish: 0,
          bearish: 0,
          neutral: 0,
          mixed: 0,
          threads: new Set<number>(),
        };
        current.count++;
        current.threads.add(post.thread_no);
        current[mention.stance as "bullish" | "bearish" | "neutral" | "mixed"] =
          (current[
            mention.stance as "bullish" | "bearish" | "neutral" | "mixed"
          ] ?? 0) + 1;
        securities.set(symbol, current);
      }
    }

    return [...securities.values()]
      .map(({ threads, ...security }) => ({
        ...security,
        weight: security.count * 4 + threads.size * 3,
      }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 20);
  }

  private extractTopSubjects(posts: any[]) {
    const subjects = new Map<string, { count: number; threads: Set<number> }>();
    for (const post of posts) {
      for (const tag of post.tags ?? []) {
        if (tag.tag_type !== "subject") continue;
        const value = this.normalizeSignalTerm(tag.value);
        if (!value || value === "not_market_relevant") continue;
        const current = subjects.get(value) ?? {
          count: 0,
          threads: new Set<number>(),
        };
        current.count++;
        current.threads.add(post.thread_no);
        subjects.set(value, current);
      }
    }

    return [...subjects.entries()]
      .map(([value, stats]) =>
        this.term(
          value,
          stats.count,
          stats.count * 2 + stats.threads.size,
          "subject",
        ),
      )
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 12);
  }

  private extractTopTags(posts: any[]) {
    const tags = new Map<string, { count: number; threads: Set<number> }>();
    for (const post of posts) {
      for (const tag of post.tags ?? []) {
        if (!["ai_tag", "security"].includes(tag.tag_type)) continue;
        const value = this.normalizeSignalTerm(tag.value);
        if (!value || this.isNoiseTerm(value)) continue;
        const current = tags.get(value) ?? {
          count: 0,
          threads: new Set<number>(),
        };
        current.count++;
        current.threads.add(post.thread_no);
        tags.set(value, current);
      }
    }

    return [...tags.entries()]
      .map(([value, stats]) =>
        this.term(
          value,
          stats.count,
          stats.count * 2 + stats.threads.size,
          "tag",
        ),
      )
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 30);
  }

  private extractSignalTerms(posts: any[]) {
    const terms = new Map<
      string,
      {
        value: string;
        count: number;
        weight: number;
        kind: string;
        threads: Set<number>;
      }
    >();
    const addTerm = (
      rawValue: string,
      kind: "security" | "tag" | "subject" | "phrase" | "term",
      weight: number,
      threadNo: number,
    ) => {
      const value =
        kind === "security"
          ? rawValue.trim().toUpperCase()
          : this.normalizeSignalTerm(rawValue);
      if (!value || this.isNoiseTerm(value)) return;
      const current = terms.get(value) ?? {
        value,
        count: 0,
        weight: 0,
        kind,
        threads: new Set<number>(),
      };
      current.count++;
      current.weight += weight;
      current.threads.add(threadNo);
      terms.set(value, current);
    };

    for (const post of posts) {
      for (const mention of post.security_mentions ?? []) {
        addTerm(mention.symbol, "security", 7, post.thread_no);
      }

      for (const tag of post.tags ?? []) {
        if (tag.tag_type === "subject") {
          addTerm(tag.value, "subject", 4, post.thread_no);
        } else if (tag.tag_type === "ai_tag" || tag.tag_type === "security") {
          addTerm(tag.value, "tag", 3, post.thread_no);
        }
      }

      for (const phrase of this.extractFinancePhrases(post.clean_text ?? "")) {
        addTerm(phrase, "phrase", 2.5, post.thread_no);
      }

      for (const token of this.extractFinanceTokens(post.clean_text ?? "")) {
        addTerm(token, "term", 1, post.thread_no);
      }
    }

    return [...terms.values()]
      .map(({ threads, ...term }) => ({
        ...term,
        weight: Math.round((term.weight + threads.size * 2) * 10) / 10,
      }))
      .filter((term) => term.count > 1 || term.kind === "security")
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 40);
  }

  private buildStructuredTermExclusions(
    posts: any[],
    blacklistedTerms = new Set<string>(),
  ) {
    const excluded = new Set<string>();
    for (const term of blacklistedTerms) {
      excluded.add(term);
    }

    for (const post of posts) {
      for (const mention of post.security_mentions ?? []) {
        const symbol = String(mention.symbol ?? "");
        excluded.add(symbol.toLowerCase());
        excluded.add(`$${symbol.toLowerCase()}`);
      }

      for (const tag of post.tags ?? []) {
        if (!["subject", "ai_tag", "security"].includes(tag.tag_type)) {
          continue;
        }
        const normalized = this.normalizeSignalTerm(tag.value);
        if (normalized) excluded.add(normalized);
      }
    }

    for (const subject of [
      "crypto",
      "equities",
      "macro",
      "options",
      "security",
    ]) {
      excluded.add(subject);
    }

    return excluded;
  }

  private extractTerminologyTerms(posts: any[], excludedTerms: Set<string>) {
    const terms = new Map<
      string,
      {
        value: string;
        count: number;
        weight: number;
        threads: Set<number>;
        kind: string;
      }
    >();
    const addTerm = (
      rawValue: string,
      kind: "phrase" | "term",
      threadNo: number,
    ) => {
      const value = this.normalizeSignalTerm(rawValue);
      if (
        !value ||
        excludedTerms.has(value) ||
        this.isTerminologyNoise(value)
      ) {
        return;
      }
      const current = terms.get(value) ?? {
        value,
        count: 0,
        weight: 0,
        threads: new Set<number>(),
        kind,
      };
      current.count++;
      current.weight += kind === "phrase" ? 2.2 : 1;
      current.threads.add(threadNo);
      terms.set(value, current);
    };

    for (const post of posts) {
      const tokens = this.extractTerminologyTokens(
        post.clean_text ?? "",
        excludedTerms,
      );
      for (const token of tokens) {
        addTerm(token, "term", post.thread_no);
      }

      for (const phrase of this.extractTerminologyPhrases(tokens)) {
        addTerm(phrase, "phrase", post.thread_no);
      }
    }

    return [...terms.values()]
      .map(({ threads, ...term }) => ({
        ...term,
        weight: Math.round((term.weight + threads.size * 2.5) * 10) / 10,
      }))
      .filter((term) => term.count >= 3 || term.weight >= 7)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 40);
  }

  private extractTerminologyTokens(text: string, excludedTerms: Set<string>) {
    const stripped = text
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/>>\d+/g, " ")
      .replace(/\$[a-z]{1,8}\b/g, " ")
      .replace(/[^a-z0-9\s-]/g, " ");
    const tokens = stripped.match(/\b[a-z][a-z0-9-]{2,20}\b/g) ?? [];

    return tokens
      .map((token) => this.normalizeSignalTerm(token))
      .filter(
        (token) =>
          token && !excludedTerms.has(token) && !this.isTerminologyNoise(token),
      );
  }

  private extractTerminologyPhrases(tokens: string[]) {
    const phrases: string[] = [];
    for (let index = 0; index < tokens.length - 1; index++) {
      const twoWord = `${tokens[index]} ${tokens[index + 1]}`;
      if (!this.isTerminologyNoise(twoWord)) phrases.push(twoWord);
    }

    for (let index = 0; index < tokens.length - 2; index++) {
      const threeWord = `${tokens[index]} ${tokens[index + 1]} ${tokens[index + 2]}`;
      if (!this.isTerminologyNoise(threeWord)) phrases.push(threeWord);
    }

    return phrases;
  }

  private pickSignalEvidencePosts(posts: any[]) {
    return [...posts]
      .map((post) => ({
        post,
        score:
          (post.security_mentions?.length ?? 0) * 5 +
          (post.tags?.filter((tag: any) =>
            ["subject", "ai_tag", "security"].includes(tag.tag_type),
          ).length ?? 0) *
            2,
      }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.post.posted_at.getTime() - a.post.posted_at.getTime(),
      )
      .map(({ post }) => post);
  }

  private extractFinancePhrases(text: string) {
    const lower = text.toLowerCase();
    const phrases = [
      "rate cuts",
      "rate hike",
      "interest rates",
      "money printer",
      "short squeeze",
      "gamma squeeze",
      "market maker",
      "bull market",
      "bear market",
      "price target",
      "earnings call",
      "buy calls",
      "buy puts",
      "sell puts",
      "covered calls",
      "all time high",
      "new ath",
      "support level",
      "resistance level",
      "breakout",
      "recession",
      "inflation",
      "cpi print",
      "fed meeting",
      "spot etf",
      "liquidation",
      "open interest",
    ];

    return phrases.filter((phrase) => lower.includes(phrase));
  }

  private extractFinanceTokens(text: string) {
    const financeWords = new Set([
      "calls",
      "puts",
      "short",
      "long",
      "pump",
      "dump",
      "moon",
      "rally",
      "crash",
      "breakout",
      "support",
      "resistance",
      "earnings",
      "inflation",
      "recession",
      "fed",
      "rates",
      "cpi",
      "fomc",
      "yield",
      "bonds",
      "options",
      "leverage",
      "liquidation",
      "whales",
      "volume",
      "volatility",
      "ath",
      "dip",
      "bags",
      "accumulate",
      "miners",
      "etf",
      "memecoin",
      "stablecoin",
    ]);
    const tokens = new Set<string>();

    for (const match of text.matchAll(/\$([A-Za-z]{1,8})(?![A-Za-z])/g)) {
      tokens.add(match[1].toUpperCase());
    }

    for (const match of text.toLowerCase().match(/\b[a-z][a-z0-9]{2,18}\b/g) ??
      []) {
      if (financeWords.has(match) && !this.isNoiseTerm(match)) {
        tokens.add(match);
      }
    }

    return [...tokens];
  }

  private normalizeSignalTerm(value: string) {
    return String(value ?? "")
      .toLowerCase()
      .replace(/[_-]+/g, " ")
      .replace(/[^a-z0-9$ ]+/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  private isNoiseTerm(value: string) {
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
      "anonymous",
      "thread",
      "post",
      "posts",
      "reply",
      "replies",
      "image",
      "jpg",
      "png",
      "webm",
      "https",
      "http",
      "com",
      "www",
      "lol",
      "lmao",
      "kek",
      "based",
      "bro",
      "bros",
      "shit",
      "fuck",
      "fucking",
      "people",
      "think",
      "know",
      "like",
      "going",
      "really",
      "still",
      "even",
      "only",
      "because",
      "there",
      "their",
      "then",
      "than",
      "been",
      "would",
      "could",
      "should",
      "make",
      "made",
      "much",
      "more",
      "some",
      "very",
      "about",
    ]);
    const normalized = this.normalizeSignalTerm(value);
    return (
      normalized.length < 3 ||
      stop.has(normalized) ||
      /^p?\d+$/.test(normalized) ||
      /^x+$/.test(normalized)
    );
  }

  private isTerminologyNoise(value: string) {
    const normalized = this.normalizeSignalTerm(value);
    if (this.isNoiseTerm(normalized)) return true;

    const words = normalized.split(" ").filter(Boolean);
    if (words.length === 0 || words.length > 3) return true;

    const stop = new Set([
      "all",
      "also",
      "any",
      "anyone",
      "anything",
      "back",
      "being",
      "better",
      "cant",
      "did",
      "didnt",
      "does",
      "doesnt",
      "doing",
      "done",
      "dont",
      "down",
      "every",
      "everyone",
      "everything",
      "getting",
      "give",
      "good",
      "got",
      "has",
      "hasnt",
      "having",
      "her",
      "here",
      "him",
      "his",
      "how",
      "ill",
      "into",
      "its",
      "keep",
      "let",
      "look",
      "maybe",
      "need",
      "never",
      "now",
      "off",
      "one",
      "our",
      "out",
      "over",
      "own",
      "please",
      "right",
      "same",
      "see",
      "she",
      "something",
      "sure",
      "take",
      "these",
      "thing",
      "things",
      "those",
      "through",
      "time",
      "too",
      "try",
      "two",
      "use",
      "want",
      "was",
      "way",
      "well",
      "were",
      "who",
      "why",
      "won",
      "wont",
      "yes",
      "yet",
    ]);

    if (words.every((word) => stop.has(word))) return true;
    if (words.length > 1 && words.some((word) => word.length < 3)) return true;

    const genericPhrases = new Set([
      "you are",
      "you can",
      "you have",
      "you know",
      "this is",
      "that is",
      "there is",
      "going to",
      "want to",
      "need to",
      "have to",
      "looks like",
      "feels like",
      "right now",
      "all in",
      "just buy",
      "just sell",
    ]);

    return genericPhrases.has(normalized);
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
