import { BadRequestException, Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";
import { birdCheck } from "./bird.runner";
import type {
  CredentialsStatusResponse,
  UpsertCredentialsDto,
} from "./x.types";

@Injectable()
export class XCredentialsService {
  constructor(private readonly prisma: PrismaService) {}

  async status(userId: string): Promise<CredentialsStatusResponse> {
    const row = await this.prisma.x_credentials.findUnique({
      where: { user_id: userId },
    });
    return {
      connected: !!row,
      twitter_handle: row?.twitter_handle ?? null,
      is_valid: row?.is_valid ?? false,
      last_checked_at: row?.last_checked_at ?? null,
    };
  }

  async upsert(userId: string, dto: UpsertCredentialsDto) {
    const auth_token = dto.auth_token?.trim();
    const ct0 = dto.ct0?.trim();
    if (!auth_token || !ct0) {
      throw new BadRequestException("auth_token and ct0 are required");
    }

    const check = await birdCheck({ auth_token, ct0 });
    if (!check.ok) {
      throw new BadRequestException(
        `Twitter cookies rejected by bird: ${check.error}`,
      );
    }

    const now = new Date();
    await this.prisma.x_credentials.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        auth_token,
        ct0,
        twitter_handle: check.handle ?? null,
        is_valid: true,
        last_checked_at: now,
      },
      update: {
        auth_token,
        ct0,
        twitter_handle: check.handle ?? null,
        is_valid: true,
        last_checked_at: now,
      },
    });

    return {
      connected: true,
      twitter_handle: check.handle ?? null,
      is_valid: true,
      last_checked_at: now,
    } satisfies CredentialsStatusResponse;
  }

  async revalidate(userId: string): Promise<CredentialsStatusResponse> {
    const row = await this.prisma.x_credentials.findUnique({
      where: { user_id: userId },
    });
    if (!row) {
      return {
        connected: false,
        twitter_handle: null,
        is_valid: false,
        last_checked_at: null,
      };
    }
    const check = await birdCheck({
      auth_token: row.auth_token,
      ct0: row.ct0,
    });
    const now = new Date();
    const updated = await this.prisma.x_credentials.update({
      where: { user_id: userId },
      data: {
        is_valid: check.ok,
        last_checked_at: now,
        twitter_handle: check.ok ? check.handle ?? row.twitter_handle : row.twitter_handle,
      },
    });
    return {
      connected: true,
      twitter_handle: updated.twitter_handle,
      is_valid: updated.is_valid,
      last_checked_at: updated.last_checked_at,
    };
  }

  async remove(userId: string) {
    await this.prisma.x_credentials.deleteMany({
      where: { user_id: userId },
    });
    return { connected: false };
  }

  /** Internal: get raw creds for ingest. Returns null if absent or invalid. */
  async getValidCreds(userId: string) {
    const row = await this.prisma.x_credentials.findUnique({
      where: { user_id: userId },
    });
    if (!row || !row.is_valid) return null;
    return { auth_token: row.auth_token, ct0: row.ct0 };
  }
}
