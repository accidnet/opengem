-- 단일 에이전트의 이메일 업무에서 모드·에이전트별 다중 예약으로 확장합니다.
-- 외래 키가 켜진 채로 이전 보고서와 메일 확인 위치를 함께 옮깁니다.
ALTER TABLE agent_routines RENAME TO previous_routines;
ALTER TABLE agent_reports RENAME TO previous_reports;
ALTER TABLE agent_routine_seen_messages RENAME TO previous_seen_messages;

CREATE TABLE agent_routines (
  id TEXT PRIMARY KEY,
  mode_id INTEGER NOT NULL REFERENCES operation_modes(id) ON DELETE CASCADE,
  agent_id TEXT,
  title TEXT NOT NULL DEFAULT '이메일 모니터링',
  kind TEXT NOT NULL DEFAULT 'email' CHECK(kind IN ('email', 'prompt')),
  instruction TEXT NOT NULL,
  interval_minutes INTEGER NOT NULL CHECK(interval_minutes BETWEEN 5 AND 10080),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
  checkpoint INTEGER NOT NULL,
  mailbox_email TEXT,
  scheduled_at INTEGER NOT NULL DEFAULT 0,
  next_run_at INTEGER NOT NULL,
  last_run_at INTEGER,
  last_error TEXT,
  lease_id TEXT,
  lease_expires_at INTEGER
);
INSERT INTO agent_routines (
  id, mode_id, agent_id, instruction, interval_minutes, enabled, checkpoint,
  mailbox_email, scheduled_at, next_run_at, last_run_at, last_error
) SELECT id, mode_id, agent_id, instruction, interval_minutes, enabled, checkpoint,
         mailbox_email, next_run_at, next_run_at, last_run_at, last_error FROM previous_routines;

CREATE TABLE agent_reports (
  id TEXT PRIMARY KEY,
  routine_id TEXT NOT NULL REFERENCES agent_routines(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('success', 'error')),
  created_at INTEGER NOT NULL
);
INSERT INTO agent_reports SELECT * FROM previous_reports;
CREATE TABLE agent_routine_seen_messages (
  routine_id TEXT NOT NULL REFERENCES agent_routines(id) ON DELETE CASCADE,
  mailbox_email TEXT NOT NULL,
  message_id TEXT NOT NULL,
  checked_until INTEGER NOT NULL,
  PRIMARY KEY (routine_id, mailbox_email, message_id)
);
INSERT INTO agent_routine_seen_messages SELECT * FROM previous_seen_messages;
DROP TABLE previous_seen_messages;
DROP TABLE previous_reports;
DROP TABLE previous_routines;
CREATE INDEX idx_agent_routines_due ON agent_routines(enabled, next_run_at);
CREATE INDEX idx_agent_reports_routine ON agent_reports(routine_id, created_at);
