-- LAVRAY Cloud PostgreSQL Migration 003
-- Account verification, password resets, device revocation, E2EE key envelope, and versioned sync with tombstones

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_verified_at BIGINT,
  ADD COLUMN IF NOT EXISTS e2ee_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS e2ee_key_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS e2ee_key_envelope JSONB,
  ADD COLUMN IF NOT EXISTS token_epoch INTEGER NOT NULL DEFAULT 1;

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS revoked_at BIGINT;

ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS device_id TEXT REFERENCES devices(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_device ON refresh_tokens(device_id);

CREATE TABLE IF NOT EXISTS account_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at BIGINT NOT NULL,
  used_at BIGINT,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_account_tokens_user_purpose ON account_tokens(user_id, purpose);

CREATE TABLE IF NOT EXISTS sync_records (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  version BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  deleted_at BIGINT,
  client_change_id TEXT,
  encrypted BOOLEAN NOT NULL DEFAULT FALSE,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (user_id, profile_id, entity_type, id)
);

CREATE INDEX IF NOT EXISTS idx_sync_records_cursor
  ON sync_records(user_id, profile_id, version ASC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_records_client_change
  ON sync_records(user_id, profile_id, client_change_id)
  WHERE client_change_id IS NOT NULL;
