-- 설정 저장이나 에이전트 삭제 후에도 발신 기록을 유지한다.
-- 이전 메시지는 저장된 표시 이름을 사용하고 과거 작성자의 ID는 추측하지 않는다.
ALTER TABLE chat_messages ADD COLUMN agent_id TEXT;
