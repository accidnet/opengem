ALTER TABLE llm_settings
ADD COLUMN openai_oauth_enabled INTEGER NOT NULL DEFAULT 1;

ALTER TABLE llm_settings
ADD COLUMN openai_oauth_priority INTEGER NOT NULL DEFAULT 1;

ALTER TABLE llm_settings
ADD COLUMN openai_api_key_enabled INTEGER NOT NULL DEFAULT 1;

ALTER TABLE llm_settings
ADD COLUMN openai_api_key_priority INTEGER NOT NULL DEFAULT 2;
