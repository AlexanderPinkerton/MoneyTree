CREATE TABLE "biz_term_blacklist" (
    "id" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "normalized_term" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "biz_term_blacklist_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "biz_term_blacklist_normalized_term_key" ON "biz_term_blacklist"("normalized_term");

CREATE INDEX "biz_term_blacklist_created_at_idx" ON "biz_term_blacklist"("created_at");
