-- agent_role 컬럼 추가: 'main' 또는 'sub' (기본값 'sub')
ALTER TABLE operation_mode_agents
ADD COLUMN agent_role TEXT NOT NULL DEFAULT 'sub';

-- 기존 각 모드에서 id가 가장 낮은(가장 먼저 생성된) 에이전트를 main으로 지정
UPDATE operation_mode_agents
SET agent_role = 'main'
WHERE id IN (
  SELECT MIN(id)
  FROM operation_mode_agents
  GROUP BY mode_id
);
