-- LAVRAY Cloud PostgreSQL Migration 002
-- Independent First-Party Web Index & Incremental Resumable Crawler State

CREATE TABLE IF NOT EXISTS lavray_index_documents (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  canonical_url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  main_content TEXT NOT NULL,
  snippet TEXT NOT NULL,
  headings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  language TEXT NOT NULL DEFAULT 'en',
  source_domain TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'web',
  content_hash TEXT NOT NULL,
  authority_score REAL NOT NULL DEFAULT 0.5,
  authority_method TEXT NOT NULL DEFAULT 'domain_tier_v1',
  published_at TEXT,
  crawled_at BIGINT NOT NULL,
  index_version TEXT NOT NULL DEFAULT 'v1',
  embedding_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(main_content, '')), 'B')
  ) STORED
);

CREATE INDEX IF NOT EXISTS idx_lavray_index_tsv ON lavray_index_documents USING GIN(tsv);
CREATE INDEX IF NOT EXISTS idx_lavray_index_domain ON lavray_index_documents(source_domain);
CREATE INDEX IF NOT EXISTS idx_lavray_index_hash ON lavray_index_documents(content_hash);
CREATE INDEX IF NOT EXISTS idx_lavray_index_crawled ON lavray_index_documents(crawled_at DESC);

CREATE TABLE IF NOT EXISTS crawl_checkpoints (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  state_json JSONB NOT NULL,
  started_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  completed_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_crawl_checkpoints_updated ON crawl_checkpoints(updated_at DESC);
