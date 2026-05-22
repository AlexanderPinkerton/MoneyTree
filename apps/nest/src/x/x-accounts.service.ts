import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";
import type { CreateAccountDto } from "./x.types";

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

@Injectable()
export class XAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  list(activeOnly = false) {
    return this.prisma.x_account.findMany({
      where: activeOnly ? { is_active: true } : undefined,
      orderBy: [
        { is_active: "desc" },
        { is_default: "desc" },
        { weight: "desc" },
        { handle: "asc" },
      ],
    });
  }

  async create(dto: CreateAccountDto) {
    const handle = dto.handle?.trim().replace(/^@/, "");
    if (!handle || !HANDLE_RE.test(handle)) {
      throw new BadRequestException(
        "Handle must be 1-15 chars: letters, digits, underscores",
      );
    }
    const existing = await this.prisma.x_account.findUnique({
      where: { handle },
    });
    if (existing) {
      if (!existing.is_active) {
        return this.prisma.x_account.update({
          where: { handle },
          data: { is_active: true, label: dto.label ?? existing.label },
        });
      }
      throw new BadRequestException(`@${handle} already tracked`);
    }
    return this.prisma.x_account.create({
      data: {
        handle,
        label: dto.label?.trim() || null,
        weight: dto.weight ?? 0.5,
        is_default: false,
        is_active: true,
      },
    });
  }

  async deactivate(id: string) {
    const account = await this.prisma.x_account.findUnique({ where: { id } });
    if (!account) throw new NotFoundException("Account not found");
    return this.prisma.x_account.update({
      where: { id },
      data: { is_active: false },
    });
  }

  async reactivate(id: string) {
    const account = await this.prisma.x_account.findUnique({ where: { id } });
    if (!account) throw new NotFoundException("Account not found");
    return this.prisma.x_account.update({
      where: { id },
      data: { is_active: true },
    });
  }
}
