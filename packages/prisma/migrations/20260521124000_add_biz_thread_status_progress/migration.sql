-- AlterTable
ALTER TABLE "biz_ingest_run" ADD COLUMN "threads_planned" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "biz_thread" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

-- Existing captured threads are considered active until the next catalog ingest marks missing threads archived.
UPDATE "biz_thread" SET "active" = true WHERE "active" IS NULL;
