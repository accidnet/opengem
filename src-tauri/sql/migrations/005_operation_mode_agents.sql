CREATE TABLE IF NOT EXISTS operation_mode_agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode_id INTEGER NOT NULL,
  agent_name TEXT NOT NULL,
  icon TEXT NOT NULL,
  color TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  model TEXT,
  prompt TEXT,
  tools TEXT,
  mcp_servers TEXT,
  skills TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(mode_id) REFERENCES operation_modes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_operation_mode_agents_mode_order
ON operation_mode_agents (mode_id, display_order, id);
