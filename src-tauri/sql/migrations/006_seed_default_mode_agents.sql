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

-- 아직 이 마이그레이션을 적용하지 않은 빈 모드에만 기본 에이전트 한 명을 생성합니다.
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
    '젬' AS agent_name,
    'account_tree' AS icon,
    'indigo' AS color,
    'gpt-5.4' AS model,
    '사용자의 요청을 이해하고 조사, 계획, 구현 등 필요한 작업을 직접 수행해. 다른 에이전트가 있으면 필요에 따라 협업해.' AS prompt,
    '["웹 브라우저","파일 시스템"]' AS tools,
    '[]' AS mcp_servers,
    '[]' AS skills,
    0 AS display_order
) AS seeded
WHERE operation_modes.mode_name = 'Orchestration'
  AND NOT EXISTS (
    SELECT 1
    FROM operation_mode_agents
    WHERE operation_mode_agents.mode_id = operation_modes.id
  );
