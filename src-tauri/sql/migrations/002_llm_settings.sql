CREATE TABLE IF NOT EXISTS providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  protocol TEXT NOT NULL
);

INSERT OR IGNORE INTO providers (key, label, protocol)
VALUES
  ('openai', 'OpenAI', 'openai'),
  ('anthropic', 'Anthropic', 'anthropic'),
  ('google', 'Google', 'google'),
  ('openrouter', 'OpenRouter', 'openrouter'),
  ('custom', 'Custom', 'openai-compatible');

CREATE TABLE IF NOT EXISTS llm_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  provider_id INTEGER NOT NULL,
  provider_kind TEXT NOT NULL DEFAULT 'api_key',
  base_url TEXT NOT NULL DEFAULT 'https://api.openai.com/v1',
  model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(provider_id) REFERENCES providers(id)
);

INSERT OR IGNORE INTO llm_settings (id, provider_id, provider_kind, base_url, model)
VALUES (
  1,
  (SELECT id FROM providers WHERE key = 'openai'),
  'api_key',
  'https://api.openai.com/v1',
  'gpt-4o-mini'
);
