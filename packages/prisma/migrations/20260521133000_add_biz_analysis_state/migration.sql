-- AlterTable
ALTER TABLE "biz_post"
ADD COLUMN "analysis_state" TEXT NOT NULL DEFAULT 'raw',
ADD COLUMN "triaged_at" TIMESTAMP(3),
ADD COLUMN "ai_analyzed_at" TIMESTAMP(3),
ADD COLUMN "analysis_model" TEXT,
ADD COLUMN "analysis_version" TEXT,
ADD COLUMN "analysis_error" TEXT;

-- Backfill from existing job/tag state.
UPDATE "biz_post"
SET "analysis_state" = 'triaged',
    "triaged_at" = COALESCE("analyzed_at", "updated_at")
WHERE "analyzed_at" IS NOT NULL;

UPDATE "biz_post"
SET "analysis_state" = 'ai_queued'
WHERE "id" IN (
    SELECT DISTINCT "post_id"
    FROM "biz_analysis_job"
    WHERE "stage" = 'ai_enrichment'
      AND "status" IN ('queued', 'running')
      AND "post_id" IS NOT NULL
);

UPDATE "biz_post"
SET "analysis_state" = 'ai_analyzed',
    "ai_analyzed_at" = COALESCE("analyzed_at", "updated_at")
WHERE "id" IN (
    SELECT DISTINCT "post_id"
    FROM "biz_post_tag"
    WHERE "source" = 'openai'
      AND "post_id" IS NOT NULL
);

UPDATE "biz_post"
SET "analysis_state" = 'failed'
WHERE "id" IN (
    SELECT DISTINCT "post_id"
    FROM "biz_analysis_job"
    WHERE "status" = 'failed'
      AND "post_id" IS NOT NULL
);

-- CreateIndex
CREATE INDEX "biz_post_analysis_state_idx" ON "biz_post"("analysis_state");
