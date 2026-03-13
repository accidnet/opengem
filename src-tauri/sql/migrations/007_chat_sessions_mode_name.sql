ALTER TABLE chat_sessions ADD COLUMN mode_name TEXT NOT NULL DEFAULT 'Orchestration';

UPDATE chat_sessions
SET mode_name = 'Orchestration'
WHERE TRIM(COALESCE(mode_name, '')) = '';

CREATE INDEX IF NOT EXISTS idx_chat_sessions_mode_updated_at
ON chat_sessions (mode_name, updated_at DESC, id);
