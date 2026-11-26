-- Atlas Browser Schema Migration 004: Local Reading List Persistence

CREATE TABLE IF NOT EXISTS reading_list (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  site_name TEXT,
  excerpt TEXT,
  status TEXT NOT NULL DEFAULT 'unread',
  progress INTEGER NOT NULL DEFAULT 0,
  saved_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reading_list_saved_at ON reading_list(saved_at DESC);
