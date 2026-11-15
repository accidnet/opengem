-- 에이전트 설정을 다시 저장해도 대화 대상이 유지되도록 별도 ID를 사용합니다.
ALTER TABLE operation_mode_agents ADD COLUMN agent_id TEXT;
UPDATE operation_mode_agents SET agent_id = 'agent-' || lower(hex(randomblob(16))) WHERE agent_id IS NULL;
CREATE UNIQUE INDEX idx_operation_mode_agents_agent_id ON operation_mode_agents(agent_id);

-- NULL은 모드 전체 대화, 값이 있으면 해당 에이전트와의 개별 대화입니다.
ALTER TABLE chat_sessions ADD COLUMN agent_id TEXT;
