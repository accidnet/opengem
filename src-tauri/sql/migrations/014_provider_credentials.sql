CREATE TABLE IF NOT EXISTS provider_credentials (
  credential_id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL,
  credential_type TEXT NOT NULL,
  api_key TEXT,
  access_token TEXT,
  refresh_token TEXT,
  expires_at INTEGER,
  account_id TEXT,
  email TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider_id, credential_type)
);

INSERT INTO provider_credentials (
  provider_id,
  credential_type,
  api_key,
  updated_at
)
SELECT
  CASE
    WHEN COALESCE(provider_id, 'openai') = 'chatgpt' THEN 'openai'
    ELSE COALESCE(provider_id, 'openai')
  END,
  'api_key',
  api_key,
  CURRENT_TIMESTAMP
FROM llm_settings
WHERE api_key IS NOT NULL AND TRIM(api_key) != ''
ON CONFLICT(provider_id, credential_type) DO UPDATE SET
  api_key = excluded.api_key,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO provider_credentials (
  provider_id,
  credential_type,
  access_token,
  refresh_token,
  expires_at,
  account_id,
  email,
  updated_at
)
SELECT
  'openai',
  'oauth',
  access_token,
  refresh_token,
  expires_at,
  account_id,
  chatgpt_email,
  CURRENT_TIMESTAMP
FROM llm_settings
WHERE refresh_token IS NOT NULL AND TRIM(refresh_token) != ''
ON CONFLICT(provider_id, credential_type) DO UPDATE SET
  access_token = excluded.access_token,
  refresh_token = excluded.refresh_token,
  expires_at = excluded.expires_at,
  account_id = excluded.account_id,
  email = excluded.email,
  updated_at = CURRENT_TIMESTAMP;

UPDATE llm_settings
SET provider_id = CASE
  WHEN COALESCE(provider_id, 'openai') = 'chatgpt' THEN 'openai'
  ELSE COALESCE(provider_id, 'openai')
END;
