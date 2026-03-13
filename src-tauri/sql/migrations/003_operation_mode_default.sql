INSERT OR IGNORE INTO operation_modes (mode_name, display_order, is_selected)
VALUES ('Orchestration', 0, 1);

DELETE FROM operation_modes
WHERE LOWER(mode_name) IN ('orchestrator', 'orchestration', 'operator', 'ochestration')
  AND mode_name <> 'Orchestration';

UPDATE operation_modes
SET display_order = 0
WHERE mode_name = 'Orchestration';

UPDATE operation_modes
SET is_selected = CASE
  WHEN mode_name = 'Orchestration' THEN 1
  ELSE 0
END
WHERE EXISTS (
  SELECT 1
  FROM operation_modes
  WHERE mode_name = 'Orchestration'
);
