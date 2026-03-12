CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  message_order INTEGER NOT NULL,
  side TEXT NOT NULL,
  type TEXT NOT NULL,
  sender TEXT,
  byline TEXT,
  avatar_text TEXT,
  icon TEXT,
  icon_color TEXT,
  text TEXT,
  status_text TEXT,
  plan_title TEXT,
  steps_json TEXT,
  logs_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at
ON chat_sessions (updated_at DESC, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_session_order
ON chat_messages (session_id, message_order);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created_at
ON chat_messages (session_id, created_at, id);
