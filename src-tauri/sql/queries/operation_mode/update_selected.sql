UPDATE operation_modes
SET is_selected = CASE
  WHEN mode_name = ?1 THEN 1
  ELSE 0
END
WHERE EXISTS (
  SELECT 1
  FROM operation_modes
  WHERE mode_name = ?1
);
