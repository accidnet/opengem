CREATE TABLE IF NOT EXISTS provider_credentials (
  credential_id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id INTEGER NOT NULL,
  credential_type TEXT NOT NULL,
  api_key TEXT,
  access_token TEXT,
  refresh_token TEXT,
  expires_at INTEGER,
  account_id TEXT,
  email TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(provider_id) REFERENCES providers(id) ON DELETE CASCADE,
  UNIQUE(provider_id, credential_type)
);
