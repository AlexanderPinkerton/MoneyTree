import { Module } from "@nestjs/common";

import { RealtimeModule } from "../realtime/realtime.module";
import { XAccountsService } from "./x-accounts.service";
import { XAiService } from "./x-ai.service";
import { XController } from "./x.controller";
import { XCredentialsService } from "./x-credentials.service";
import { XIngestService } from "./x-ingest.service";
import { XSentimentService } from "./x-sentiment.service";

@Module({
  imports: [RealtimeModule],
  controllers: [XController],
  providers: [
    XAccountsService,
    XCredentialsService,
    XIngestService,
    XAiService,
    XSentimentService,
  ],
  exports: [
    XAccountsService,
    XCredentialsService,
    XIngestService,
    XAiService,
    XSentimentService,
  ],
})
export class XModule {}
