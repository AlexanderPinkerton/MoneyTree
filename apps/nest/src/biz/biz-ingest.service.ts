import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { BizProcessingService } from "./biz-processing.service";
import type {
  FetchJsonResult,
  FourChanCatalogPage,
  FourChanThreadResponse,
} from "./biz.types";

const BOARD = "biz";
const API_BASE = "https://a.4cdn.org";
const REQUEST_DELAY_MS = 1100;
const FETCH_TIMEOUT_MS = 20000;
const THREAD_FETCH_LIMIT = 160;
type IngestCounters = {
  catalog_threads: number;
  threads_planned: number;
  threads_checked: number;
  threads_changed: number;
  new_threads: number;
  new_posts: number;
  updated_posts: number;
  error_count: number;
};

@Injectable()
export class BizIngestService {
  private readonly logger = new Logger(BizIngestService.name);
  private isRunning = false;
  private lastRequestAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly processing: BizProcessingService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleCron() {
    await this.runIngest("cron");
  }

  async runIngest(trigger: "cron" | "manual" = "manual") {
    if (this.isRunning) {
      this.logger.warn(
        `Skipping ${trigger} ingest because another run is active`,
      );
      return null;
    }

    this.isRunning = true;
    const run = await this.prisma.biz_ingest_run.create({
      data: { status: "running" },
    });

    const counters: IngestCounters = {
      catalog_threads: 0,
      threads_planned: 0,
      threads_checked: 0,
      threads_changed: 0,
      new_threads: 0,
      new_posts: 0,
      updated_posts: 0,
      error_count: 0,
    };

    try {
      this.emitProgress(
        run.id,
        "started",
        counters,
        `${trigger} ingest started`,
      );
      this.logger.log(`/${BOARD}/ ingest ${run.id} started by ${trigger}`);

      this.emitProgress(
        run.id,
        "catalog",
        counters,
        `Fetching /${BOARD}/ catalog`,
      );
      const catalogResult = await this.fetchWithState<FourChanCatalogPage[]>(
        `${BOARD}:catalog`,
        `${API_BASE}/${BOARD}/catalog.json`,
      );

      if (catalogResult.status === "error") {
        throw new Error(
          catalogResult.errorMessage ?? "Failed to fetch catalog",
        );
      }

      if (catalogResult.status === "not_modified") {
        this.emitProgress(
          run.id,
          "catalog_not_modified",
          counters,
          "Catalog was not modified since the last successful fetch",
        );
        await this.completeRun(run.id, counters);
        return { ...counters, runId: run.id };
      }

      const threads = (catalogResult.data ?? []).flatMap(
        (page) => page.threads ?? [],
      );
      counters.catalog_threads = threads.length;
      await this.markThreadActivity(threads.map((thread) => thread.no));
      this.emitProgress(
        run.id,
        "catalog_loaded",
        counters,
        `Catalog loaded with ${threads.length} active threads`,
      );

      const existingThreads = await this.prisma.biz_thread.findMany({
        where: { thread_no: { in: threads.map((thread) => thread.no) } },
        select: { thread_no: true, last_modified: true },
      });
      const existingByNo = new Map(
        existingThreads.map((thread) => [thread.thread_no, thread]),
      );

      const changedThreads = threads
        .filter((thread) => {
          const existing = existingByNo.get(thread.no);
          const catalogModified = thread.last_modified
            ? new Date(thread.last_modified * 1000)
            : null;

          return (
            !existing ||
            !existing.last_modified ||
            !catalogModified ||
            catalogModified > existing.last_modified
          );
        })
        .slice(0, THREAD_FETCH_LIMIT);
      counters.threads_planned = changedThreads.length;

      this.emitProgress(
        run.id,
        "thread_fetch_plan",
        counters,
        `Checking ${changedThreads.length} changed/new threads at 1 request per second`,
      );

      for (const catalogThread of changedThreads) {
        counters.threads_checked++;
        if (
          counters.threads_checked === 1 ||
          counters.threads_checked % 10 === 0
        ) {
          this.emitProgress(
            run.id,
            "threads",
            counters,
            `Checking thread ${counters.threads_checked}/${changedThreads.length}`,
          );
        }

        try {
          const didChange = await this.ingestThread(catalogThread.no);
          if (didChange.changed) counters.threads_changed++;
          counters.new_threads += didChange.newThread ? 1 : 0;
          counters.new_posts += didChange.newPosts;
          counters.updated_posts += didChange.updatedPosts;
          if (didChange.newPosts > 0 || didChange.updatedPosts > 0) {
            this.emitProgress(
              run.id,
              "posts",
              counters,
              `Thread ${catalogThread.no}: ${didChange.newPosts} new posts, ${didChange.updatedPosts} updated`,
            );
          }
        } catch (error) {
          counters.error_count++;
          this.logger.warn(
            `Failed to ingest /${BOARD}/ thread ${catalogThread.no}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          this.emitProgress(
            run.id,
            "thread_error",
            counters,
            `Thread ${catalogThread.no} failed; continuing`,
          );
        }
      }

      this.emitProgress(
        run.id,
        "analysis_queued",
        counters,
        "Analysis jobs queued for the independent analysis worker",
      );
      await this.completeRun(run.id, counters);

      if (counters.new_posts > 0) {
        this.realtime.broadcastBizUpdate({
          type: "biz_update",
          event: "new_posts",
          run_id: run.id,
          new_posts: counters.new_posts,
          new_threads: counters.new_threads,
        });
      }

      return { ...counters, runId: run.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.biz_ingest_run.update({
        where: { id: run.id },
        data: {
          ...counters,
          status: "failed",
          finished_at: new Date(),
          error_message: message,
        },
      });
      this.realtime.broadcastBizUpdate({
        type: "biz_update",
        event: "ingest_failed",
        run_id: run.id,
        message,
      });
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  private async ingestThread(threadNo: number) {
    const threadUrl = `${API_BASE}/${BOARD}/thread/${threadNo}.json`;
    const result = await this.fetchWithState<FourChanThreadResponse>(
      `${BOARD}:thread:${threadNo}`,
      threadUrl,
    );

    if (result.status === "not_modified") {
      return { changed: false, newThread: false, newPosts: 0, updatedPosts: 0 };
    }
    if (result.status === "error" || !result.data?.posts?.length) {
      throw new Error(result.errorMessage ?? "Thread response had no posts");
    }

    const posts = result.data.posts;
    const op = posts[0];
    const sourceUrl = `https://boards.4chan.org/${BOARD}/thread/${threadNo}`;
    const existingThread = await this.prisma.biz_thread.findUnique({
      where: { thread_no: threadNo },
      select: { id: true },
    });

    await this.prisma.biz_thread.upsert({
      where: { thread_no: threadNo },
      update: {
        subject: op.sub ?? null,
        semantic_url: op.semantic_url ?? null,
        source_url: sourceUrl,
        replies: op.replies ?? posts.length - 1,
        images: op.images ?? 0,
        sticky: op.sticky === 1,
        closed: op.closed === 1,
        active: true,
        archived: false,
        last_modified: op.last_modified
          ? new Date(op.last_modified * 1000)
          : new Date(Math.max(...posts.map((post) => post.time)) * 1000),
        last_seen_at: new Date(),
      },
      create: {
        board: BOARD,
        thread_no: threadNo,
        subject: op.sub ?? null,
        semantic_url: op.semantic_url ?? null,
        source_url: sourceUrl,
        replies: op.replies ?? posts.length - 1,
        images: op.images ?? 0,
        sticky: op.sticky === 1,
        closed: op.closed === 1,
        active: true,
        archived: false,
        last_modified: op.last_modified
          ? new Date(op.last_modified * 1000)
          : new Date(Math.max(...posts.map((post) => post.time)) * 1000),
      },
    });

    let newPosts = 0;
    let updatedPosts = 0;

    for (const rawPost of posts) {
      const normalized = this.processing.normalizePost(rawPost, threadNo);
      const existingPost = await this.prisma.biz_post.findUnique({
        where: { post_no: normalized.postNo },
        select: { id: true, clean_text: true },
      });
      const contentChanged = existingPost?.clean_text !== normalized.cleanText;

      const savedPost = await this.prisma.biz_post.upsert({
        where: { post_no: normalized.postNo },
        update: {
          subject: normalized.subject,
          author_name: normalized.authorName,
          poster_id: normalized.posterId,
          posted_at: normalized.postedAt,
          source_url: normalized.sourceUrl,
          raw_comment_html: normalized.rawCommentHtml,
          clean_text: normalized.cleanText,
          raw_json: this.toJson(normalized.rawJson),
          attachment: normalized.attachment
            ? this.toJson(normalized.attachment)
            : Prisma.JsonNull,
          analysis_state: contentChanged ? "stale" : undefined,
          analysis_error: contentChanged ? null : undefined,
        },
        create: {
          board: BOARD,
          post_no: normalized.postNo,
          thread_no: normalized.threadNo,
          is_op: normalized.isOp,
          subject: normalized.subject,
          author_name: normalized.authorName,
          poster_id: normalized.posterId,
          posted_at: normalized.postedAt,
          source_url: normalized.sourceUrl,
          raw_comment_html: normalized.rawCommentHtml,
          clean_text: normalized.cleanText,
          raw_json: this.toJson(normalized.rawJson),
          attachment: normalized.attachment
            ? this.toJson(normalized.attachment)
            : Prisma.JsonNull,
          analysis_state: "raw",
        },
      });

      if (!existingPost) {
        newPosts++;
        await this.processing.enqueueTriage(savedPost.id, threadNo);
      } else if (contentChanged) {
        updatedPosts++;
        await this.processing.enqueueTriage(savedPost.id, threadNo);
      }
    }

    return {
      changed: true,
      newThread: !existingThread,
      newPosts,
      updatedPosts,
    };
  }

  private async fetchWithState<T>(
    resourceKey: string,
    resourceUrl: string,
  ): Promise<FetchJsonResult<T>> {
    const state = await this.prisma.biz_fetch_state.upsert({
      where: { resource_key: resourceKey },
      update: { resource_url: resourceUrl, last_checked_at: new Date() },
      create: {
        resource_key: resourceKey,
        resource_url: resourceUrl,
        last_checked_at: new Date(),
      },
    });

    await this.throttle();

    try {
      const response = await fetch(resourceUrl, {
        headers: state.last_modified_header
          ? { "If-Modified-Since": state.last_modified_header }
          : undefined,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (response.status === 304) {
        await this.prisma.biz_fetch_state.update({
          where: { resource_key: resourceKey },
          data: { last_success_at: new Date() },
        });
        return { status: "not_modified" };
      }

      if (!response.ok) {
        const message = `${response.status} ${response.statusText}`;
        await this.prisma.biz_fetch_state.update({
          where: { resource_key: resourceKey },
          data: {
            last_error_at: new Date(),
            last_error_message: message,
          },
        });
        return { status: "error", errorMessage: message };
      }

      const data = (await response.json()) as T;
      const lastModified = response.headers.get("last-modified");
      await this.prisma.biz_fetch_state.update({
        where: { resource_key: resourceKey },
        data: {
          last_modified_header: lastModified,
          last_success_at: new Date(),
          last_error_message: null,
        },
      });

      return { status: "ok", data, lastModified };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.biz_fetch_state.update({
        where: { resource_key: resourceKey },
        data: {
          last_error_at: new Date(),
          last_error_message: message,
        },
      });
      return { status: "error", errorMessage: message };
    }
  }

  private async throttle() {
    const now = Date.now();
    const elapsed = now - this.lastRequestAt;
    if (elapsed < REQUEST_DELAY_MS) {
      await new Promise((resolve) =>
        setTimeout(resolve, REQUEST_DELAY_MS - elapsed),
      );
    }
    this.lastRequestAt = Date.now();
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private async markThreadActivity(activeThreadNos: number[]) {
    if (activeThreadNos.length === 0) {
      return;
    }

    await this.prisma.$transaction([
      this.prisma.biz_thread.updateMany({
        where: { thread_no: { in: activeThreadNos } },
        data: { active: true, archived: false, last_seen_at: new Date() },
      }),
      this.prisma.biz_thread.updateMany({
        where: { thread_no: { notIn: activeThreadNos }, active: true },
        data: { active: false, archived: true },
      }),
    ]);
  }

  private emitProgress(
    runId: string,
    phase: string,
    counters: IngestCounters,
    message: string,
  ) {
    this.logger.log(
      `/${BOARD}/ ingest ${runId} [${phase}] ${message} ` +
        `(threads ${counters.threads_checked}/${counters.threads_planned}, ` +
        `new posts ${counters.new_posts}, errors ${counters.error_count})`,
    );
    this.realtime.broadcastBizUpdate({
      type: "biz_update",
      event: phase === "started" ? "ingest_started" : "ingest_progress",
      run_id: runId,
      phase,
      catalog_threads: counters.catalog_threads,
      threads_planned: counters.threads_planned,
      threads_checked: counters.threads_checked,
      threads_changed: counters.threads_changed,
      new_threads: counters.new_threads,
      new_posts: counters.new_posts,
      updated_posts: counters.updated_posts,
      error_count: counters.error_count,
      message,
    });
    void this.prisma.biz_ingest_run
      .update({
        where: { id: runId },
        data: counters,
      })
      .catch((error) => {
        this.logger.warn(
          `Failed to persist /${BOARD}/ ingest progress for ${runId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }

  private async completeRun(runId: string, counters: IngestCounters) {
    await this.prisma.biz_ingest_run.update({
      where: { id: runId },
      data: {
        ...counters,
        status: "completed",
        finished_at: new Date(),
      },
    });
    this.realtime.broadcastBizUpdate({
      type: "biz_update",
      event: "ingest_completed",
      run_id: runId,
      new_posts: counters.new_posts,
      new_threads: counters.new_threads,
    });
  }
}
