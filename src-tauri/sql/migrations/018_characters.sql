-- 기본 캐릭터는 최초 마이그레이션에서만 추가하여 삭제 상태를 유지합니다.
CREATE TABLE characters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  image TEXT NOT NULL
);
INSERT INTO characters (id, name, image) VALUES
  ('chiikawa', '치이카와', 'builtin:chiikawa'),
  ('hachiware', '하치와레', 'builtin:hachiware'),
  ('usagi', '우사기', 'builtin:usagi');
ALTER TABLE operation_mode_agents ADD COLUMN character_id TEXT;
UPDATE operation_mode_agents SET character_id = CASE display_order % 3
  WHEN 0 THEN 'chiikawa' WHEN 1 THEN 'hachiware' ELSE 'usagi' END;
