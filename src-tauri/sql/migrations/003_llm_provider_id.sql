ALTER TABLE llm_settings ADD COLUMN provider_id TEXT NOT NULL DEFAULT 'openai';

UPDATE llm_settings
SET provider_id = CASE
  WHEN provider_kind = 'chatgpt_oauth' THEN 'chatgpt'
  ELSE 'openai'
END
WHERE provider_id IS NULL OR provider_id = '';
