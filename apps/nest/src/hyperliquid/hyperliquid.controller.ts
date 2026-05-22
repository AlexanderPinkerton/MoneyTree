import { Controller, Get, Query, UseGuards } from "@nestjs/common";

import { JwtAuthGuard } from "../auth/guards/jwt.auth.guard";
import { HyperliquidService } from "./hyperliquid.service";

@Controller("hyperliquid")
@UseGuards(JwtAuthGuard)
export class HyperliquidController {
  constructor(private readonly hl: HyperliquidService) {}

  @Get("perps")
  perps(@Query("dex") dex?: string) {
    return this.hl.perps({ dex });
  }
}
