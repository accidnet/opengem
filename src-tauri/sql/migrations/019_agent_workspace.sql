-- 에이전트 행은 설정 저장 때 재생성되므로 안정적인 모드 ID와 에이전트 ID를 보관합니다.
CREATE TABLE agent_memories (
  mode_id INTEGER NOT NULL REFERENCES operation_modes(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (mode_id, agent_id)
);
CREATE TABLE agent_routines (
  id TEXT PRIMARY KEY,
  mode_id INTEGER NOT NULL REFERENCES operation_modes(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  instruction TEXT NOT NULL,
  interval_minutes INTEGER NOT NULL CHECK(interval_minutes BETWEEN 5 AND 10080),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
  checkpoint INTEGER NOT NULL,
  mailbox_email TEXT,
  next_run_at INTEGER NOT NULL,
  last_run_at INTEGER,
  last_error TEXT,
  lease_id TEXT,
  lease_expires_at INTEGER,
  UNIQUE(mode_id, agent_id)
);
CREATE INDEX idx_agent_routines_due ON agent_routines(enabled, next_run_at);
CREATE TABLE agent_reports (
  id TEXT PRIMARY KEY,
  routine_id TEXT NOT NULL REFERENCES agent_routines(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('success', 'error')),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_agent_reports_routine ON agent_reports(routine_id, created_at);
-- OAuth 비밀값은 OS 자격 증명 저장소에 두고 연결 상태만 SQLite에 저장합니다.
CREATE TABLE email_connection_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  client_id TEXT NOT NULL DEFAULT '',
  credential_key TEXT NOT NULL DEFAULT '',
  email TEXT,
  connected INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
INSERT INTO email_connection_settings (id) VALUES (1);

CREATE TABLE agent_routine_seen_messages (
  routine_id TEXT NOT NULL REFERENCES agent_routines(id) ON DELETE CASCADE,
  mailbox_email TEXT NOT NULL,
  message_id TEXT NOT NULL,
  checked_until INTEGER NOT NULL,
  PRIMARY KEY (routine_id, mailbox_email, message_id)
);

CREATE INDEX idx_chat_sessions_agent_scope ON chat_sessions(mode_name, agent_id);
