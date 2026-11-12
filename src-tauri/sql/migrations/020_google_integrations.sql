-- 기존 Gmail 연결은 그대로 유지하고 추가 서비스는 사용자가 따로 연결합니다.
CREATE TABLE google_service_connections (
  service TEXT PRIMARY KEY CHECK(service IN ('gmail','drive','calendar')),
  credential_key TEXT NOT NULL DEFAULT '',
  email TEXT,
  connected INTEGER NOT NULL DEFAULT 0 CHECK(connected IN (0,1)),
  granted_scopes TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT 0
);
INSERT INTO google_service_connections(service,credential_key,email,connected,granted_scopes,updated_at)
SELECT 'gmail',credential_key,email,connected,'https://www.googleapis.com/auth/gmail.readonly',updated_at FROM email_connection_settings WHERE id=1;
INSERT INTO google_service_connections(service) VALUES ('drive'),('calendar');
