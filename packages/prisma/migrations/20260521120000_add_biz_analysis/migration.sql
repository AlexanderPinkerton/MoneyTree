-- CreateTable
CREATE TABLE "biz_ingest_run" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "catalog_threads" INTEGER NOT NULL DEFAULT 0,
    "threads_checked" INTEGER NOT NULL DEFAULT 0,
    "threads_changed" INTEGER NOT NULL DEFAULT 0,
    "new_threads" INTEGER NOT NULL DEFAULT 0,
    "new_posts" INTEGER NOT NULL DEFAULT 0,
    "updated_posts" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "biz_ingest_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "biz_fetch_state" (
    "id" TEXT NOT NULL,
    "resource_key" TEXT NOT NULL,
    "resource_url" TEXT NOT NULL,
    "last_modified_header" TEXT,
    "last_checked_at" TIMESTAMP(3),
    "last_success_at" TIMESTAMP(3),
    "last_error_at" TIMESTAMP(3),
    "last_error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "biz_fetch_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "biz_thread" (
    "id" TEXT NOT NULL,
    "board" TEXT NOT NULL DEFAULT 'biz',
    "thread_no" INTEGER NOT NULL,
    "subject" TEXT,
    "semantic_url" TEXT,
    "source_url" TEXT NOT NULL,
    "replies" INTEGER NOT NULL DEFAULT 0,
    "images" INTEGER NOT NULL DEFAULT 0,
    "sticky" BOOLEAN NOT NULL DEFAULT false,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "last_modified" TIMESTAMP(3),
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "biz_thread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "biz_post" (
    "id" TEXT NOT NULL,
    "board" TEXT NOT NULL DEFAULT 'biz',
    "post_no" INTEGER NOT NULL,
    "thread_no" INTEGER NOT NULL,
    "is_op" BOOLEAN NOT NULL DEFAULT false,
    "subject" TEXT,
    "author_name" TEXT,
    "poster_id" TEXT,
    "posted_at" TIMESTAMP(3) NOT NULL,
    "source_url" TEXT NOT NULL,
    "raw_comment_html" TEXT,
    "clean_text" TEXT NOT NULL,
    "raw_json" JSONB NOT NULL,
    "attachment" JSONB,
    "analyzed_at" TIMESTAMP(3),
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "biz_post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "biz_analysis_job" (
    "id" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "post_id" TEXT,
    "thread_no" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "biz_analysis_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "biz_post_tag" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "tag_type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "biz_post_tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "biz_security_mention" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "thread_no" INTEGER NOT NULL,
    "symbol" TEXT NOT NULL,
    "display_name" TEXT,
    "asset_type" TEXT,
    "sentiment" TEXT NOT NULL,
    "stance" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "evidence_snippet" TEXT,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "biz_security_mention_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "biz_fetch_state_resource_key_key" ON "biz_fetch_state"("resource_key");

-- CreateIndex
CREATE UNIQUE INDEX "biz_thread_thread_no_key" ON "biz_thread"("thread_no");

-- CreateIndex
CREATE INDEX "biz_thread_last_seen_at_idx" ON "biz_thread"("last_seen_at");

-- CreateIndex
CREATE INDEX "biz_thread_last_modified_idx" ON "biz_thread"("last_modified");

-- CreateIndex
CREATE UNIQUE INDEX "biz_post_post_no_key" ON "biz_post"("post_no");

-- CreateIndex
CREATE INDEX "biz_post_thread_no_idx" ON "biz_post"("thread_no");

-- CreateIndex
CREATE INDEX "biz_post_posted_at_idx" ON "biz_post"("posted_at");

-- CreateIndex
CREATE INDEX "biz_post_first_seen_at_idx" ON "biz_post"("first_seen_at");

-- CreateIndex
CREATE INDEX "biz_analysis_job_status_stage_idx" ON "biz_analysis_job"("status", "stage");

-- CreateIndex
CREATE INDEX "biz_analysis_job_post_id_idx" ON "biz_analysis_job"("post_id");

-- CreateIndex
CREATE INDEX "biz_analysis_job_thread_no_idx" ON "biz_analysis_job"("thread_no");

-- CreateIndex
CREATE UNIQUE INDEX "biz_post_tag_post_id_tag_type_value_source_key" ON "biz_post_tag"("post_id", "tag_type", "value", "source");

-- CreateIndex
CREATE INDEX "biz_post_tag_tag_type_value_idx" ON "biz_post_tag"("tag_type", "value");

-- CreateIndex
CREATE UNIQUE INDEX "biz_security_mention_post_id_symbol_source_key" ON "biz_security_mention"("post_id", "symbol", "source");

-- CreateIndex
CREATE INDEX "biz_security_mention_symbol_idx" ON "biz_security_mention"("symbol");

-- CreateIndex
CREATE INDEX "biz_security_mention_stance_idx" ON "biz_security_mention"("stance");

-- CreateIndex
CREATE INDEX "biz_security_mention_sentiment_idx" ON "biz_security_mention"("sentiment");

-- CreateIndex
CREATE INDEX "biz_security_mention_thread_no_idx" ON "biz_security_mention"("thread_no");

-- AddForeignKey
ALTER TABLE "biz_post" ADD CONSTRAINT "biz_post_thread_no_fkey" FOREIGN KEY ("thread_no") REFERENCES "biz_thread"("thread_no") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biz_analysis_job" ADD CONSTRAINT "biz_analysis_job_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "biz_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biz_post_tag" ADD CONSTRAINT "biz_post_tag_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "biz_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biz_security_mention" ADD CONSTRAINT "biz_security_mention_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "biz_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
