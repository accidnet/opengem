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

CREATE TABLE IF NOT EXISTS provider_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id INTEGER NOT NULL,
  api_url TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(provider_id) REFERENCES providers(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO provider_settings (id, provider_id, api_url)
VALUES (
  1,
  (SELECT id FROM providers WHERE key = 'openai'),
  'https://api.openai.com/v1'
);

CREATE TABLE IF NOT EXISTS llm_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  provider_settings_id INTEGER NOT NULL,
  model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(provider_settings_id) REFERENCES provider_settings(id)
);

INSERT OR IGNORE INTO llm_settings (id, provider_settings_id, model)
VALUES (
  1,
  (
    SELECT id
    FROM provider_settings
    WHERE id = 1
  ),
  'gpt-4o-mini'
);
