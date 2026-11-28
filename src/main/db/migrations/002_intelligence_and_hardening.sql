-- LAVRAY Browser Schema Migration 002: Long-horizon checkpoints, research reports, page change detection, semantic memory

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS task_checkpoints (
  run_id TEXT PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE,
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS research_reports (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  report_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_research_created ON research_reports(created_at DESC);

CREATE TABLE IF NOT EXISTS page_snapshots (
  url TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  headings_json TEXT NOT NULL DEFAULT '[]',
  text_fingerprint TEXT NOT NULL,
  text_excerpt TEXT NOT NULL,
  text_length INTEGER NOT NULL DEFAULT 0,
  captured_at INTEGER NOT NULL
);

ALTER TABLE memory ADD COLUMN profile_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE memory ADD COLUMN source_url TEXT;
ALTER TABLE memory ADD COLUMN expires_at INTEGER;
ALTER TABLE memory ADD COLUMN embedding_json TEXT;

CREATE INDEX IF NOT EXISTS idx_memory_profile ON memory(profile_id);
