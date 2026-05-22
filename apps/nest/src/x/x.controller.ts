import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { JwtAuthGuard } from "../auth/guards/jwt.auth.guard";
import { PrismaService } from "../prisma/prisma.service";
import { XAccountsService } from "./x-accounts.service";
import { XAiService } from "./x-ai.service";
import { XCredentialsService } from "./x-credentials.service";
import { XIngestService } from "./x-ingest.service";
import { XSentimentService } from "./x-sentiment.service";
import type { CreateAccountDto, UpsertCredentialsDto } from "./x.types";

function userIdFromRequest(req: FastifyRequest): string {
  const payload = req.user as any;
  const id = payload?.sub ?? payload?.user_id ?? payload?.id;
  if (!id) {
    throw new BadRequestException("User ID missing from token");
  }
  return id;
}

@Controller("x")
@UseGuards(JwtAuthGuard)
export class XController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: XAccountsService,
    private readonly credentials: XCredentialsService,
    private readonly ingest: XIngestService,
    private readonly ai: XAiService,
    private readonly sentiment: XSentimentService,
  ) {}

  // ============================================================================
  // Accounts (shared across users)
  // ============================================================================

  @Get("accounts")
  listAccounts(@Query("activeOnly") activeOnly?: string) {
    return this.accounts.list(activeOnly === "true");
  }

  @Post("accounts")
  createAccount(@Body() body: CreateAccountDto) {
    return this.accounts.create(body);
  }

  @Delete("accounts/:id")
  deactivateAccount(@Param("id") id: string) {
    return this.accounts.deactivate(id);
  }

  @Post("accounts/:id/restore")
  restoreAccount(@Param("id") id: string) {
    return this.accounts.reactivate(id);
  }

  // ============================================================================
  // Credentials (per-user)
  // ============================================================================

  @Get("credentials")
  credentialsStatus(@Req() req: FastifyRequest) {
    return this.credentials.status(userIdFromRequest(req));
  }

  @Post("credentials")
  upsertCredentials(
    @Req() req: FastifyRequest,
    @Body() body: UpsertCredentialsDto,
  ) {
    return this.credentials.upsert(userIdFromRequest(req), body);
  }

  @Post("credentials/check")
  revalidateCredentials(@Req() req: FastifyRequest) {
    return this.credentials.revalidate(userIdFromRequest(req));
  }

  @Delete("credentials")
  removeCredentials(@Req() req: FastifyRequest) {
    return this.credentials.remove(userIdFromRequest(req));
  }

  // ============================================================================
  // Tweets feed
  // ============================================================================

  @Get("tweets")
  async listTweets(
    @Query("handle") handle?: string,
    @Query("limit") limit = "50",
  ) {
    const take = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    return this.prisma.x_tweet.findMany({
      where: handle ? { handle } : undefined,
      orderBy: { posted_at: "desc" },
      take,
    });
  }

  // ============================================================================
  // Ingest controls
  // ============================================================================

  @Get("ingest/status")
  ingestStatus() {
    return this.ingest.status();
  }

  @Post("ingest/run")
  runIngest() {
    return this.ingest.runIngest("manual");
  }

  // ============================================================================
  // AI analysis
  // ============================================================================

  @Get("analysis/status")
  analysisStatus() {
    return this.ai.status();
  }

  @Post("analysis/run")
  runAnalysis() {
    return this.ai.runOnce();
  }

  @Post("analysis/pause")
  pauseAnalysis() {
    return this.ai.pause();
  }

  @Post("analysis/resume")
  resumeAnalysis() {
    return this.ai.resume();
  }

  // ============================================================================
  // Sentiment aggregation
  // ============================================================================

  @Get("sentiment")
  sentimentOverview(
    @Query("window") window?: string,
    @Query("handle") handle?: string,
    @Query("limit") limit?: string,
  ) {
    return this.sentiment.tickerOverview({
      window,
      handle,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get("sentiment/ticker/:symbol")
  sentimentTicker(
    @Param("symbol") symbol: string,
    @Query("window") window?: string,
  ) {
    return this.sentiment.tickerDetail(symbol, { window });
  }
}
