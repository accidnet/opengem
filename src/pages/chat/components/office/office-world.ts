export type OfficePoint = { x: number; z: number };
export type OfficeBounds = { minX: number; maxX: number; minZ: number; maxZ: number };
export type OfficeObstacle = OfficeBounds;
export type OfficeLayout = {
  bounds: OfficeBounds;
  desks: OfficePoint[];
  spawns: OfficePoint[];
  obstacles: OfficeObstacle[];
};
export type OfficePositions = Record<string, OfficePoint>;

export const OFFICE_DESK_SIZE = { width: 2.15, depth: 1 };
export const OFFICE_AGENT_RADIUS = 0.3;
export const OFFICE_WALK_SPEED = 2.8;

function rectangle(x: number, z: number, width: number, depth: number): OfficeObstacle {
  return { minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2 };
}

// 인원이 늘면 같은 방의 길이를 늘려 모든 에이전트에게 자리를 제공합니다.
export function getOfficeLayout(agentCount: number): OfficeLayout {
  const count = Number.isFinite(agentCount) ? Math.max(0, Math.floor(agentCount)) : 0;
  const rows = Math.max(2, Math.ceil(count / 4));
  const bounds = { minX: -7.5, maxX: 7.5, minZ: -5.5, maxZ: 5.5 + (rows - 2) * 3.5 };
  const desks = Array.from({ length: rows * 4 }, (_, index) => ({
    x: [-4.5, -1.5, 1.5, 4.5][index % 4],
    z: -2.8 + Math.floor(index / 4) * 3.5,
  }));
  const obstacles = desks.map(({ x, z }) =>
    rectangle(x, z, OFFICE_DESK_SIZE.width, OFFICE_DESK_SIZE.depth)
  );
  obstacles.push(
    rectangle(-4.8, bounds.maxZ - 1.15, 2.4, 0.85),
    rectangle(6.4, -3.7, 0.9, 2),
    rectangle(-6.5, -4.6, 0.7, 0.7),
    rectangle(6.4, bounds.maxZ - 1, 0.7, 0.7)
  );
  return { bounds, desks, spawns: desks.map(({ x, z }) => ({ x, z: z + 1 })), obstacles };
}

// 카메라의 수평 방향을 기준으로 화면의 위/오른쪽과 이동 키를 일치시킵니다.
export function getMovementDirection(
  keys: ReadonlySet<string>,
  camera: OfficePoint = { x: 12, z: 16 }
): OfficePoint {
  const horizontal =
    Number(keys.has("KeyD") || keys.has("ArrowRight")) -
    Number(keys.has("KeyA") || keys.has("ArrowLeft"));
  const vertical =
    Number(keys.has("KeyW") || keys.has("ArrowUp")) -
    Number(keys.has("KeyS") || keys.has("ArrowDown"));
  const inputLength = Math.hypot(horizontal, vertical);
  if (!inputLength) return { x: 0, z: 0 };
  const cameraLength = Math.hypot(camera.x, camera.z);
  const cameraX = Number.isFinite(cameraLength) && cameraLength > 0 ? camera.x / cameraLength : 0.6;
  const cameraZ = Number.isFinite(cameraLength) && cameraLength > 0 ? camera.z / cameraLength : 0.8;
  return {
    x: (horizontal * cameraZ - vertical * cameraX) / inputLength,
    z: (-horizontal * cameraX - vertical * cameraZ) / inputLength,
  };
}

export function isOfficePositionWalkable(position: OfficePoint, layout: OfficeLayout): boolean {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.z)) return false;
  const r = OFFICE_AGENT_RADIUS;
  const { bounds } = layout;
  if (
    position.x < bounds.minX + r ||
    position.x > bounds.maxX - r ||
    position.z < bounds.minZ + r ||
    position.z > bounds.maxZ - r
  )
    return false;
  return !layout.obstacles.some(
    (obstacle) =>
      position.x > obstacle.minX - r &&
      position.x < obstacle.maxX + r &&
      position.z > obstacle.minZ - r &&
      position.z < obstacle.maxZ + r
  );
}

// 축별 충돌 처리를 통해 가구를 관통하지 않고 가장자리를 따라 움직입니다.
export function moveOfficeAgent(
  position: OfficePoint,
  direction: OfficePoint,
  deltaSeconds: number,
  layout: OfficeLayout,
  speed = OFFICE_WALK_SPEED
): OfficePoint {
  const origin = isOfficePositionWalkable(position, layout) ? position : layout.spawns[0];
  const length = Math.hypot(direction.x, direction.z);
  const dt = Number.isFinite(deltaSeconds) ? Math.max(0, Math.min(deltaSeconds, 0.05)) : 0;
  if (!length || !Number.isFinite(length) || !Number.isFinite(speed) || speed <= 0 || !dt) {
    return { ...origin };
  }
  const r = OFFICE_AGENT_RADIUS;
  const { bounds } = layout;
  const dx = (direction.x / length) * speed * dt;
  const dz = (direction.z / length) * speed * dt;
  let x = Math.max(bounds.minX + r, Math.min(bounds.maxX - r, origin.x + dx));
  for (const obstacle of layout.obstacles) {
    if (origin.z <= obstacle.minZ - r || origin.z >= obstacle.maxZ + r) continue;
    if (dx > 0 && origin.x <= obstacle.minX - r && x > obstacle.minX - r) x = obstacle.minX - r;
    if (dx < 0 && origin.x >= obstacle.maxX + r && x < obstacle.maxX + r) x = obstacle.maxX + r;
  }
  let z = Math.max(bounds.minZ + r, Math.min(bounds.maxZ - r, origin.z + dz));
  for (const obstacle of layout.obstacles) {
    if (x <= obstacle.minX - r || x >= obstacle.maxX + r) continue;
    if (dz > 0 && origin.z <= obstacle.minZ - r && z > obstacle.minZ - r) z = obstacle.minZ - r;
    if (dz < 0 && origin.z >= obstacle.maxZ + r && z < obstacle.maxZ + r) z = obstacle.maxZ + r;
  }
  return { x, z };
}

// 오래되거나 손상된 저장 위치는 버리고 현재 배치에서 안전한 위치만 복원합니다.
export function decodeOfficePositions(raw: string | null, layout: OfficeLayout): OfficePositions {
  if (!raw || raw.length > 1_000_000) return {};
  try {
    const data: unknown = JSON.parse(raw);
    if (
      !data ||
      typeof data !== "object" ||
      !("version" in data) ||
      data.version !== 1 ||
      !("positions" in data) ||
      !data.positions ||
      typeof data.positions !== "object" ||
      Array.isArray(data.positions)
    )
      return {};
    return Object.fromEntries(
      Object.entries(data.positions)
        .filter(
          ([key, value]) =>
            key.length > 0 &&
            key.length <= 256 &&
            value &&
            typeof value === "object" &&
            "x" in value &&
            "z" in value &&
            typeof value.x === "number" &&
            typeof value.z === "number" &&
            isOfficePositionWalkable({ x: value.x, z: value.z }, layout)
        )
        .map(([key, value]) => [key, { x: value.x, z: value.z }])
    );
  } catch {
    return {};
  }
}

export function encodeOfficePositions(positions: OfficePositions): string {
  return JSON.stringify({ version: 1, positions });
}
