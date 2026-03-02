CREATE TABLE IF NOT EXISTS operation_modes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode_name TEXT NOT NULL UNIQUE,
  display_order INTEGER NOT NULL,
  is_selected INTEGER NOT NULL DEFAULT 0 CHECK(is_selected IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_operation_modes_display_order
ON operation_modes (display_order, id);

INSERT OR IGNORE INTO operation_modes (mode_name, display_order, is_selected)
VALUES ('orchestrator', 0, 1);
