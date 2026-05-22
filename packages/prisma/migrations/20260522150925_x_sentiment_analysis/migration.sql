-- AlterTable
ALTER TABLE "x_tweet" ADD COLUMN     "analysis_error" TEXT,
ADD COLUMN     "analysis_model" TEXT,
ADD COLUMN     "analysis_version" TEXT,
ADD COLUMN     "analyzed_at" TIMESTAMP(3),
ADD COLUMN     "confidence" DOUBLE PRECISION,
ADD COLUMN     "market_relevant" BOOLEAN,
ADD COLUMN     "sentiment" TEXT,
ADD COLUMN     "stance" TEXT,
ADD COLUMN     "subject" TEXT,
ADD COLUMN     "summary" TEXT;

-- CreateTable
CREATE TABLE "x_security_mention" (
    "id" TEXT NOT NULL,
    "tweet_id_db" TEXT NOT NULL,
    "tweet_id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "display_name" TEXT,
    "asset_type" TEXT,
    "sentiment" TEXT NOT NULL,
    "stance" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "evidence_snippet" TEXT,
    "source" TEXT NOT NULL,
    "posted_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "x_security_mention_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "x_security_mention_symbol_idx" ON "x_security_mention"("symbol");

-- CreateIndex
CREATE INDEX "x_security_mention_stance_idx" ON "x_security_mention"("stance");

-- CreateIndex
CREATE INDEX "x_security_mention_sentiment_idx" ON "x_security_mention"("sentiment");

-- CreateIndex
CREATE INDEX "x_security_mention_handle_idx" ON "x_security_mention"("handle");

-- CreateIndex
CREATE INDEX "x_security_mention_posted_at_idx" ON "x_security_mention"("posted_at");

-- CreateIndex
CREATE UNIQUE INDEX "x_security_mention_tweet_id_db_symbol_source_key" ON "x_security_mention"("tweet_id_db", "symbol", "source");

-- CreateIndex
CREATE INDEX "x_tweet_sentiment_idx" ON "x_tweet"("sentiment");

-- AddForeignKey
ALTER TABLE "x_security_mention" ADD CONSTRAINT "x_security_mention_tweet_id_db_fkey" FOREIGN KEY ("tweet_id_db") REFERENCES "x_tweet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
