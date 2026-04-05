CREATE TABLE IF NOT EXISTS provider_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_settings_id INTEGER NOT NULL UNIQUE,
  credential_type TEXT NOT NULL CHECK(credential_type IN ('oauth', 'api-key')),
  api_key TEXT,
  access_token TEXT,
  refresh_token TEXT,
  expires_at INTEGER,
  account_id TEXT,
  email TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(provider_settings_id) REFERENCES provider_settings(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO provider_credentials (provider_settings_id, credential_type)
VALUES (1, 'api-key');
