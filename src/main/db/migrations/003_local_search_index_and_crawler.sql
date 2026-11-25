-- Atlas Browser SQLite Migration 003
-- Local-first First-Party Search Index (SQLite FTS5), Crawler Checkpoints & Local Search History

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS atlas_index_documents (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  canonical_url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  main_content TEXT NOT NULL,
  snippet TEXT NOT NULL,
  headings_json TEXT NOT NULL DEFAULT '[]',
  language TEXT NOT NULL DEFAULT 'en',
  source_domain TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'web',
  content_hash TEXT NOT NULL,
  authority_score REAL NOT NULL DEFAULT 0.5,
  authority_method TEXT NOT NULL DEFAULT 'domain_tier_v1',
  published_at TEXT,
  crawled_at INTEGER NOT NULL,
  index_version TEXT NOT NULL DEFAULT 'v1',
  embedding_json TEXT NOT NULL DEFAULT '[]'
);

CREATE VIRTUAL TABLE IF NOT EXISTS atlas_index_fts USING fts5(
  canonical_url UNINDEXED,
  title,
  main_content,
  headings,
  tokenize = 'porter unicode61'
);

CREATE INDEX IF NOT EXISTS idx_local_atlas_domain ON atlas_index_documents(source_domain);
CREATE INDEX IF NOT EXISTS idx_local_atlas_hash ON atlas_index_documents(content_hash);

CREATE TABLE IF NOT EXISTS crawl_checkpoints (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  state_json TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS local_search_history (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  mode TEXT NOT NULL,
  result_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_local_search_history_time ON local_search_history(created_at DESC);
