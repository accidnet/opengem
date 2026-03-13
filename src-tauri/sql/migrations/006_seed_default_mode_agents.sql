UPDATE operation_modes
SET mode_name = 'Orchestration',
    display_order = 0,
    is_selected = 1
WHERE LOWER(mode_name) IN ('orchestrator', 'orchestration', 'operator', 'ochestration');

DELETE FROM operation_modes
WHERE LOWER(mode_name) IN ('orchestrator', 'orchestration', 'operator', 'ochestration')
  AND mode_name <> 'Orchestration';

INSERT OR IGNORE INTO operation_modes (mode_name, display_order, is_selected)
VALUES ('Orchestration', 0, 1);

UPDATE operation_modes
SET is_selected = CASE
  WHEN mode_name = 'Orchestration' THEN 1
  ELSE 0
END;

INSERT INTO operation_mode_agents (
  mode_id,
  agent_name,
  icon,
  color,
  is_active,
  model,
  prompt,
  tools,
  mcp_servers,
  skills,
  display_order
)
SELECT
  operation_modes.id,
  seeded.agent_name,
  seeded.icon,
  seeded.color,
  1,
  seeded.model,
  seeded.prompt,
  seeded.tools,
  seeded.mcp_servers,
  seeded.skills,
  seeded.display_order
FROM operation_modes
JOIN (
  SELECT
    '오케스트레이터' AS agent_name,
    'account_tree' AS icon,
    'indigo' AS color,
    'gpt-5.4' AS model,
    '전체 작업을 조율하고 필요한 에이전트에게 역할을 분배해.' AS prompt,
    '["웹 브라우저","파일 시스템"]' AS tools,
    '["linear"]' AS mcp_servers,
    '["task-routing"]' AS skills,
    0 AS display_order
  UNION ALL
  SELECT
    '프론트엔드 개발자',
    'travel_explore',
    'emerald',
    'gpt-5.4',
    '프론트엔드 UI와 상호작용을 구현하고 시각 완성도를 높여.',
    '["웹 브라우저","파일 시스템"]',
    '["figma"]',
    '["design-review"]',
    1
  UNION ALL
  SELECT
    '백엔드 개발자',
    'code',
    'amber',
    'gpt-5.4-mini',
    '서버 로직, API, 데이터 흐름을 설계하고 구현해.',
    '["파일 시스템"]',
    '["postgres"]',
    '["api-design"]',
    2
) AS seeded
WHERE operation_modes.mode_name = 'Orchestration'
  AND NOT EXISTS (
    SELECT 1
    FROM operation_mode_agents
    WHERE operation_mode_agents.mode_id = operation_modes.id
  );
