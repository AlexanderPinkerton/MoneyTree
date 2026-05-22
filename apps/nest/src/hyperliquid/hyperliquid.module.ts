import { Module } from "@nestjs/common";

import { HyperliquidController } from "./hyperliquid.controller";
import { HyperliquidService } from "./hyperliquid.service";

@Module({
  controllers: [HyperliquidController],
  providers: [HyperliquidService],
  exports: [HyperliquidService],
})
export class HyperliquidModule {}
