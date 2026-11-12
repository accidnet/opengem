import assert from "node:assert/strict";
import test from "node:test";
import {
  OFFICE_AGENT_RADIUS,
  OFFICE_WALK_SPEED,
  decodeOfficePositions,
  encodeOfficePositions,
  getMovementDirection,
  getOfficeLayout,
  isOfficePositionWalkable,
  moveOfficeAgent,
} from "../src/pages/chat/components/office/office-world.ts";

const layout = getOfficeLayout(8);
const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, actual + " ≈ " + expected);

test("에이전트 수에 맞춰 방이 확장되고 모든 좌석 앞에 안전하게 생성된다", () => {
  for (const count of [0, 1, 8, 9, 20, 101]) {
    const room = getOfficeLayout(count);
    assert.ok(room.spawns.length >= count);
    assert.equal(room.desks.length, room.spawns.length);
    for (const spawn of room.spawns) assert.equal(isOfficePositionWalkable(spawn, room), true);
  }
  assert.equal(getOfficeLayout(8).bounds.maxZ, 5.5);
  assert.equal(getOfficeLayout(9).bounds.maxZ, 9);
});

test("WASD와 방향키가 카메라 기준 같은 방향으로 이동한다", () => {
  assert.deepEqual(getMovementDirection(new Set(["KeyW"])), { x: -0.6, z: -0.8 });
  assert.deepEqual(getMovementDirection(new Set(["ArrowRight"])), { x: 0.8, z: -0.6 });
  assert.deepEqual(getMovementDirection(new Set(["KeyW"]), { x: 0, z: 10 }), { x: 0, z: -1 });
  assert.deepEqual(
    getMovementDirection(new Set(["KeyW"])),
    getMovementDirection(new Set(["ArrowUp"]))
  );
  assert.deepEqual(getMovementDirection(new Set(["KeyW", "KeyS"])), { x: 0, z: 0 });
  assert.deepEqual(getMovementDirection(new Set(["Space"])), { x: 0, z: 0 });
});

test("대각선과 중복 키가 이동 속도를 늘리지 않는다", () => {
  const direction = getMovementDirection(new Set(["KeyW", "ArrowUp", "KeyD"]));
  near(Math.hypot(direction.x, direction.z), 1);
  const origin = { x: 0, z: 3 };
  const moved = moveOfficeAgent(origin, direction, 1 / 60, layout);
  near(Math.hypot(moved.x - origin.x, moved.z - origin.z), OFFICE_WALK_SPEED / 60);
});

test("프레임 속도가 달라도 같은 시간 동안 같은 거리로 이동한다", () => {
  function walk(fps) {
    let position = { x: 0, z: 3 };
    for (let frame = 0; frame < fps / 2; frame++) {
      position = moveOfficeAgent(position, { x: 1, z: 0 }, 1 / fps, layout);
    }
    return position;
  }
  near(walk(60).x, walk(120).x);
  near(walk(60).x, OFFICE_WALK_SPEED / 2);
  near(moveOfficeAgent({ x: 0, z: 3 }, { x: 1, z: 0 }, 10, layout).x, OFFICE_WALK_SPEED * 0.05);
});

test("책상 앞에서 멈추고 대각선 이동은 가구 가장자리를 따라 미끄러진다", () => {
  let position = { ...layout.spawns[0] };
  for (let frame = 0; frame < 120; frame++) {
    position = moveOfficeAgent(position, { x: 0, z: -1 }, 1 / 60, layout);
    assert.equal(isOfficePositionWalkable(position, layout), true);
  }
  near(position.z, -2);
  const slid = moveOfficeAgent(position, { x: 1, z: -1 }, 1 / 60, layout);
  assert.ok(slid.x > position.x);
  near(slid.z, position.z);
});

test("큰 이동 거리에도 얇은 가구나 방 벽을 관통하지 않는다", () => {
  const moved = moveOfficeAgent({ x: -7, z: 0.7 }, { x: 1, z: 0 }, 0.05, layout, 1000);
  near(moved.x, -4.5 - 2.15 / 2 - OFFICE_AGENT_RADIUS);
  assert.equal(isOfficePositionWalkable(moved, layout), true);
  const wall = moveOfficeAgent({ x: 7, z: 0 }, { x: 1, z: 0 }, 0.05, layout, 1000);
  near(wall.x, layout.bounds.maxX - OFFICE_AGENT_RADIUS);
});

test("소파와 커피 캐비닛, 화분에도 충돌 영역이 적용된다", () => {
  for (const point of [
    { x: -4.8, z: layout.bounds.maxZ - 1.15 },
    { x: 6.4, z: -3.7 },
    { x: -6.5, z: -4.6 },
    { x: 6.4, z: layout.bounds.maxZ - 1 },
  ])
    assert.equal(isOfficePositionWalkable(point, layout), false);
});

test("잘못된 시간과 입력 값으로 위치가 손상되지 않는다", () => {
  const origin = { x: 0, z: 3 };
  for (const dt of [NaN, Infinity, -1]) {
    assert.deepEqual(moveOfficeAgent(origin, { x: 1, z: 0 }, dt, layout), origin);
  }
  assert.deepEqual(moveOfficeAgent(origin, { x: NaN, z: 0 }, 0.01, layout), origin);
  assert.deepEqual(
    moveOfficeAgent({ x: Infinity, z: 0 }, { x: 0, z: 0 }, 0.01, layout),
    layout.spawns[0]
  );
});

test("에이전트 ID별 위치를 저장하고 안전한 위치만 복원한다", () => {
  const positions = { "agent-a": { x: 0, z: 3 }, "agent-b": layout.spawns[1] };
  assert.deepEqual(decodeOfficePositions(encodeOfficePositions(positions), layout), positions);
  const mixed = {
    valid: positions["agent-a"],
    insideDesk: layout.desks[0],
    outsideRoom: { x: 100, z: 0 },
    wrongType: { x: "1", z: 2 },
    missingCoordinate: { x: 1 },
    nullValue: null,
  };
  assert.deepEqual(
    decodeOfficePositions(JSON.stringify({ version: 1, positions: mixed }), layout),
    {
      valid: positions["agent-a"],
    }
  );
});

test("손상된 저장소와 지원하지 않는 버전은 무시하고 줄어든 방 밖 위치를 복원하지 않는다", () => {
  for (const raw of [
    null,
    "",
    "{",
    "null",
    "[]",
    '{"version":2,"positions":{}}',
    '{"version":1,"positions":[]}',
  ]) {
    assert.deepEqual(decodeOfficePositions(raw, layout), {});
  }
  const expanded = getOfficeLayout(20);
  const saved = encodeOfficePositions({ "agent-a": expanded.spawns[19] });
  assert.deepEqual(decodeOfficePositions(saved, layout), {});
  assert.deepEqual(decodeOfficePositions(saved, expanded), { "agent-a": expanded.spawns[19] });
});
