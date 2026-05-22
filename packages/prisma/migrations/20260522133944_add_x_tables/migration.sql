-- CreateTable
CREATE TABLE "x_account" (
    "id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "display_name" TEXT,
    "label" TEXT,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_fetch_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "x_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "x_tweet" (
    "id" TEXT NOT NULL,
    "tweet_id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "retweets" INTEGER NOT NULL DEFAULT 0,
    "replies" INTEGER NOT NULL DEFAULT 0,
    "views" INTEGER,
    "is_retweet" BOOLEAN NOT NULL DEFAULT false,
    "retweet_of" TEXT,
    "reply_to" TEXT,
    "url" TEXT NOT NULL,
    "posted_at" TIMESTAMP(3) NOT NULL,
    "raw_json" JSONB NOT NULL,
    "media" JSONB,
    "analysis_state" TEXT NOT NULL DEFAULT 'raw',
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "x_tweet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "x_ingest_run" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "accounts_planned" INTEGER NOT NULL DEFAULT 0,
    "accounts_checked" INTEGER NOT NULL DEFAULT 0,
    "new_tweets" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "last_error_message" TEXT,
    "trigger" TEXT,

    CONSTRAINT "x_ingest_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "x_credentials" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "auth_token" TEXT NOT NULL,
    "ct0" TEXT NOT NULL,
    "twitter_handle" TEXT,
    "last_checked_at" TIMESTAMP(3),
    "is_valid" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "x_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "x_account_handle_key" ON "x_account"("handle");

-- CreateIndex
CREATE INDEX "x_account_is_active_idx" ON "x_account"("is_active");

-- CreateIndex
CREATE INDEX "x_account_is_default_idx" ON "x_account"("is_default");

-- CreateIndex
CREATE UNIQUE INDEX "x_tweet_tweet_id_key" ON "x_tweet"("tweet_id");

-- CreateIndex
CREATE INDEX "x_tweet_handle_idx" ON "x_tweet"("handle");

-- CreateIndex
CREATE INDEX "x_tweet_posted_at_idx" ON "x_tweet"("posted_at");

-- CreateIndex
CREATE INDEX "x_tweet_first_seen_at_idx" ON "x_tweet"("first_seen_at");

-- CreateIndex
CREATE INDEX "x_tweet_analysis_state_idx" ON "x_tweet"("analysis_state");

-- CreateIndex
CREATE INDEX "x_ingest_run_started_at_idx" ON "x_ingest_run"("started_at");

-- CreateIndex
CREATE INDEX "x_ingest_run_status_idx" ON "x_ingest_run"("status");

-- CreateIndex
CREATE UNIQUE INDEX "x_credentials_user_id_key" ON "x_credentials"("user_id");

-- AddForeignKey
ALTER TABLE "x_tweet" ADD CONSTRAINT "x_tweet_handle_fkey" FOREIGN KEY ("handle") REFERENCES "x_account"("handle") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed finance handles (sourced from python_tui/jobs/sentiment_tracker/sources.py)
INSERT INTO "x_account" ("id", "handle", "label", "weight", "is_default", "is_active", "updated_at") VALUES
  (gen_random_uuid()::text, 'martinshkreli',    'Martin Shkreli',                                0.7, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'hosseeb',          'Haseeb Qureshi (crypto/VC)',                    0.6, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'labubu_trader',    '3X Long Labubu',                                0.6, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'zephyr_z9',        'Zephyr',                                        0.6, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'dnystedt',         'Dan Nystedt (Asia/semis)',                      0.6, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'researchQf',       'QF Research',                                   0.6, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'inverse_cramer',   'Inverse Cramer (inactive since 2021)',          0.5, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'DeItaone',         'Walter Bloomberg (breaking news)',              0.7, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'zerohedge',        'ZeroHedge (macro/contrarian)',                  0.5, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'unusual_whales',   'Unusual Whales (options flow)',                 0.7, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Ksidiii',          'Kris Sidial (options/vol)',                     0.6, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'stocktalkweekly',  'Stock Talk (tech sector)',                      0.6, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'borrowed_ideas',   'Mostly Borrowed Ideas (deep value tech)',       0.6, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'OptionsHawk',      'Joe Kunkle (options flow)',                     0.6, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'MrZackMorris',     'Zack Morris (small cap momentum)',              0.4, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'TaviCosta',        'Tavi Costa (commodities/macro)',                0.6, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Mayhem4Markets',   'Markets & Mayhem (macro trades)',               0.6, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'CryptoCred',       'Cred (crypto TA)',                              0.6, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Citrini7',         'Citrini (thematic/sector bets)',                0.6, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'PeterLBrandt',     'Peter Brandt (classical charting, 40yr exp)',   0.7, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'traderstewie',     'Trader Stewie (swing trading setups)',          0.6, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'investorslive',    'Nathan Michaud (day trading, small caps)',      0.6, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'danzanger',        'Dan Zanger (momentum swing trades)',            0.6, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, '3PeaksTrading',    'Jason (breadth/sentiment/options flow)',        0.6, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'cfromhertz',       'Christian Fromhertz (TA + options)',            0.6, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Burns277',         'The Street Mentor (momentum/swing)',            0.6, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'jfahmy',           'Joseph Fahmy (educational + trade ideas)',      0.6, true, true, CURRENT_TIMESTAMP)
ON CONFLICT ("handle") DO NOTHING;
