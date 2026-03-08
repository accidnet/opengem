CREATE TABLE IF NOT EXISTS llm_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  provider_kind TEXT NOT NULL DEFAULT 'api_key',
  base_url TEXT NOT NULL DEFAULT 'https://api.openai.com/v1',
  model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  api_key TEXT,
  access_token TEXT,
  refresh_token TEXT,
  expires_at INTEGER,
  account_id TEXT,
  chatgpt_email TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO llm_settings (id, provider_kind, base_url, model)
VALUES (1, 'api_key', 'https://api.openai.com/v1', 'gpt-4o-mini');
