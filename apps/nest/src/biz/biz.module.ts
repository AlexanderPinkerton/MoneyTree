import { Module } from "@nestjs/common";

import { RealtimeModule } from "../realtime/realtime.module";
import { BizAiService } from "./biz-ai.service";
import { BizController } from "./biz.controller";
import { BizIngestService } from "./biz-ingest.service";
import { BizProcessingService } from "./biz-processing.service";

@Module({
  imports: [RealtimeModule],
  controllers: [BizController],
  providers: [BizIngestService, BizProcessingService, BizAiService],
})
export class BizModule {}
