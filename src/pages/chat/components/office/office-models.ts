import * as THREE from "three";
import { OFFICE_DESK_SIZE, type OfficeLayout } from "./office-world";

type AvatarModel = {
  group: THREE.Group;
  body: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  ring: THREE.Mesh;
};

const AGENT_COLORS: Record<string, string> = {
  indigo: "#889be8",
  emerald: "#75b9a2",
  amber: "#e8b761",
  violet: "#b39add",
  rose: "#dc95a6",
};

function material(color: string, roughness = 0.75) {
  return new THREE.MeshStandardMaterial({ color, roughness });
}

function mesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  surface: THREE.Material,
  x: number,
  y: number,
  z: number
) {
  const object = new THREE.Mesh(geometry, surface);
  object.position.set(x, y, z);
  object.castShadow = true;
  object.receiveShadow = true;
  parent.add(object);
  return object;
}

function box(
  parent: THREE.Object3D,
  size: [number, number, number],
  surface: THREE.Material,
  position: [number, number, number]
) {
  return mesh(parent, new THREE.BoxGeometry(...size), surface, ...position);
}

function ball(
  parent: THREE.Object3D,
  radius: number,
  surface: THREE.Material,
  position: [number, number, number],
  scale: [number, number, number] = [1, 1, 1]
) {
  const object = mesh(parent, new THREE.SphereGeometry(radius, 16, 12), surface, ...position);
  object.scale.set(...scale);
  return object;
}

function cylinder(
  parent: THREE.Object3D,
  radii: [number, number],
  height: number,
  surface: THREE.Material,
  position: [number, number, number]
) {
  return mesh(parent, new THREE.CylinderGeometry(...radii, height, 16), surface, ...position);
}

function plant(parent: THREE.Object3D, x: number, z: number, scale = 1) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.scale.setScalar(scale);
  parent.add(group);
  const pot = material("#d6ad8e");
  const stem = material("#537a60");
  const leaf = material("#87af81");
  cylinder(group, [0.28, 0.2], 0.42, pot, [0, 0.21, 0]);
  cylinder(group, [0.25, 0.25], 0.055, pot, [0, 0.43, 0]);
  cylinder(group, [0.022, 0.025], 0.85, stem, [0, 0.8, 0]);
  for (let i = 0; i < 7; i++) {
    const angle = i * 2.4;
    const height = 0.64 + (i % 4) * 0.17;
    const leafMesh = ball(
      group,
      0.23,
      leaf,
      [Math.cos(angle) * 0.19, height, Math.sin(angle) * 0.19],
      [0.65, 1.4, 0.55]
    );
    leafMesh.rotation.set(Math.sin(angle) * 0.65, angle, Math.cos(angle) * 0.65);
  }
}

function workstation(parent: THREE.Object3D, x: number, z: number, index: number) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  parent.add(group);
  const wood = material("#d8b99a");
  const frame = material("#eee9df");
  const graphite = material("#4e5b62");
  const screen = new THREE.MeshStandardMaterial({
    color: "#9ecac3",
    emissive: "#759f98",
    emissiveIntensity: 0.15,
    roughness: 0.5,
  });
  box(group, [OFFICE_DESK_SIZE.width, 0.12, OFFICE_DESK_SIZE.depth], wood, [0, 0.86, 0]);
  for (const dx of [-0.87, 0.87]) {
    box(group, [0.085, 0.8, 0.7], frame, [dx, 0.4, 0]);
    box(group, [0.34, 0.065, 0.78], frame, [dx, 0.04, 0]);
  }
  box(group, [0.31, 0.04, 0.23], graphite, [0, 0.95, -0.12]);
  box(group, [0.065, 0.24, 0.06], graphite, [0, 1.07, -0.18]);
  box(group, [0.94, 0.59, 0.065], graphite, [0, 1.36, -0.2]);
  box(group, [0.84, 0.48, 0.012], screen, [0, 1.37, -0.16]);
  const code = material("#e3f4e9");
  for (let line = 0; line < 4; line++) {
    const length = [0.42, 0.58, 0.34, 0.5][(line + index) % 4];
    box(group, [length, 0.025, 0.014], code, [-0.34 + length / 2, 1.52 - line * 0.09, -0.147]);
  }
  box(group, [0.62, 0.035, 0.21], frame, [0, 0.945, 0.26]);
  ball(group, 0.055, graphite, [0.48, 0.953, 0.27], [0.8, 0.4, 1.25]);
  const cup = material(index % 2 ? "#b7a5ce" : "#a3c1b0");
  cylinder(group, [0.075, 0.065], 0.14, cup, [0.8, 1.0, 0.04]);
  cylinder(group, [0.055, 0.055], 0.005, material("#705746"), [0.8, 1.073, 0.04]);
  const notebook = box(group, [0.3, 0.045, 0.37], cup, [-0.76, 0.943, 0.08]);
  notebook.rotation.y = -0.15;
  // 책상 아래로 의자를 넣어 이동 경로와 충돌 영역을 일치시킵니다.
  const seat = material(index % 2 ? "#aba5c5" : "#90afa4");
  box(group, [0.48, 0.12, 0.42], seat, [0, 0.43, 0.24]);
  box(group, [0.48, 0.35, 0.1], seat, [0, 0.65, 0.43]);
  cylinder(group, [0.055, 0.055], 0.35, graphite, [0, 0.2, 0.23]);
  box(group, [0.43, 0.055, 0.055], graphite, [0, 0.06, 0.23]);
}

export function buildOfficeEnvironment(layout: OfficeLayout): THREE.Group {
  const root = new THREE.Group();
  const { minX, maxX, minZ, maxZ } = layout.bounds;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const centerZ = (minZ + maxZ) / 2;
  const cream = material("#f3ede1");
  const trim = material("#d5c6ae");
  const teal = material("#91b6a5");
  const floor = material("#e9dcc8");
  const seam = material("#d7c7af");
  const dark = material("#546461");
  const wood = material("#c9a27e");

  // 높이가 다른 받침과 열린 두 벽으로 작은 디오라마를 구성합니다.
  box(root, [width + 0.5, 0.28, depth + 0.5], trim, [0, -0.26, centerZ]);
  box(root, [width + 0.15, 0.17, depth + 0.15], floor, [0, -0.075, centerZ]);
  for (let z = minZ + 0.75; z < maxZ; z += 0.75) {
    box(root, [width, 0.006, 0.018], seam, [0, 0.013, z]);
  }
  for (let x = minX + 1.5; x < maxX; x += 1.5) {
    for (let row = 0; row < Math.ceil(depth / 0.75); row++) {
      const z = minZ + row * 0.75 + 0.375;
      if (z < maxZ) box(root, [0.012, 0.006, 0.73], seam, [x + (row % 2) * 0.5, 0.014, z]);
    }
  }
  box(root, [width + 0.3, 2.85, 0.18], cream, [0, 1.425, minZ - 0.09]);
  box(root, [0.18, 2.85, depth], cream, [minX - 0.09, 1.425, centerZ]);
  box(root, [width + 0.28, 0.12, 0.24], trim, [0, 2.88, minZ - 0.09]);
  box(root, [0.24, 0.12, depth], trim, [minX - 0.09, 2.88, centerZ]);
  box(root, [width, 0.13, 0.065], trim, [0, 0.08, minZ + 0.025]);
  box(root, [0.065, 0.13, depth], trim, [minX + 0.025, 0.08, centerZ]);

  const glass = new THREE.MeshStandardMaterial({
    color: "#c5e0df",
    emissive: "#c5e0df",
    emissiveIntensity: 0.16,
    roughness: 0.25,
  });
  for (const x of [-4.8, 3.75]) {
    box(root, [3.45, 1.65, 0.1], trim, [x, 1.69, minZ + 0.1]);
    box(root, [3.2, 1.4, 0.03], glass, [x, 1.69, minZ + 0.16]);
    box(root, [0.07, 1.4, 0.035], cream, [x, 1.69, minZ + 0.19]);
    box(root, [3.2, 0.07, 0.035], cream, [x, 1.7, minZ + 0.19]);
    box(root, [3.65, 0.09, 0.34], cream, [x, 0.84, minZ + 0.2]);
    box(root, [3.6, 0.14, 0.2], cream, [x, 2.54, minZ + 0.17]);
    // 창 밖 실루엣은 불투명한 면으로 표현해 투명 정렬 문제를 피합니다.
    for (let i = 0; i < 5; i++) {
      const height = 0.2 + ((i * 3) % 4) * 0.08;
      box(root, [0.28, height, 0.015], material("#abc9c8"), [
        x - 1.3 + i * 0.55,
        1.06 + height / 2,
        minZ + 0.18,
      ]);
    }
  }
  box(root, [2.5, 1.45, 0.11], wood, [-0.6, 1.7, minZ + 0.12]);
  box(root, [2.32, 1.27, 0.03], dark, [-0.6, 1.7, minZ + 0.19]);
  const gem = mesh(root, new THREE.OctahedronGeometry(0.33), teal, -1.2, 1.8, minZ + 0.36);
  gem.rotation.z = 0.15;
  for (let i = 0; i < 3; i++) {
    box(root, [0.85 - i * 0.15, 0.055, 0.02], cream, [-0.12, 1.96 - i * 0.22, minZ + 0.22]);
  }
  // 왼쪽 벽의 선반과 그림은 바닥 통로를 차지하지 않습니다.
  for (const z of [-2.1, 1.5]) {
    box(root, [0.08, 1.03, 1.35], wood, [minX + 0.07, 1.65, z]);
    box(root, [0.03, 0.87, 1.19], material(z < 0 ? "#b7c9b9" : "#c8bbd6"), [minX + 0.13, 1.65, z]);
    const artwork = ball(root, 0.28, cream, [minX + 0.16, 1.68, z], [0.08, 1, 1]);
    artwork.castShadow = false;
    box(root, [0.38, 0.075, 1.65], wood, [minX + 0.2, 1.02, z]);
  }

  layout.desks.forEach((desk, index) => workstation(root, desk.x, desk.z, index));
  const loungeZ = maxZ - 1.15;
  const rug = box(root, [3.8, 0.022, 2.0], material("#c5d1c6"), [-4.8, 0.023, loungeZ - 0.12]);
  rug.receiveShadow = true;
  box(root, [3.5, 0.024, 1.7], material("#d8dfd0"), [-4.8, 0.025, loungeZ - 0.12]);
  const upholstery = material("#92aca2");
  box(root, [2.4, 0.34, 0.85], upholstery, [-4.8, 0.38, loungeZ]);
  box(root, [2.4, 0.45, 0.19], upholstery, [-4.8, 0.7, loungeZ + 0.32]);
  for (const x of [-5.89, -3.71]) {
    box(root, [0.22, 0.4, 0.85], upholstery, [x, 0.63, loungeZ]);
  }
  for (const x of [-5.3, -4.3]) {
    box(root, [0.92, 0.13, 0.58], material("#adc1b5"), [x, 0.61, loungeZ - 0.08]);
    for (const z of [loungeZ - 0.3, loungeZ + 0.3]) {
      cylinder(root, [0.045, 0.045], 0.23, wood, [x, 0.115, z]);
    }
  }
  const cushion = box(root, [0.37, 0.32, 0.16], material("#d9b9aa"), [-5.42, 0.81, loungeZ + 0.13]);
  cushion.rotation.z = -0.14;
  const cushion2 = box(root, [0.37, 0.32, 0.16], material("#e0d5b5"), [
    -4.15,
    0.81,
    loungeZ + 0.13,
  ]);
  cushion2.rotation.z = 0.16;

  box(root, [0.9, 0.9, 2], teal, [6.4, 0.45, -3.7]);
  box(root, [0.96, 0.08, 2.05], cream, [6.4, 0.94, -3.7]);
  box(root, [0.03, 0.62, 0.025], cream, [5.94, 0.48, -3.7]);
  box(root, [0.43, 0.55, 0.43], dark, [6.4, 1.25, -4.15]);
  box(root, [0.035, 0.24, 0.3], material("#bccbc5"), [6.17, 1.3, -4.15]);
  box(root, [0.18, 0.045, 0.38], dark, [6.08, 1.02, -4.15]);
  cylinder(root, [0.06, 0.05], 0.12, cream, [6.08, 1.1, -4.15]);
  for (let i = 0; i < 3; i++) {
    cylinder(root, [0.07, 0.06], 0.14, material("#d7bc93"), [6.38, 1.05, -3.4 + i * 0.22]);
  }
  plant(root, -6.5, -4.6);
  plant(root, 6.4, maxZ - 1.0);
  return root;
}

export function createOfficeAvatar(color: string, index: number): AvatarModel {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const accent = material(AGENT_COLORS[color] || AGENT_COLORS.indigo);
  const porcelain = material("#faf4e8", 0.55);
  const visor = material("#374b50", 0.35);
  const eye = new THREE.MeshStandardMaterial({
    color: "#d4f3e8",
    emissive: "#a6e5d3",
    emissiveIntensity: 0.4,
  });
  const shoe = material("#51626b");
  ball(body, 0.27, accent, [0, 0.64, 0], [0.92, 1.1, 0.8]);
  ball(body, 0.32, porcelain, [0, 1.05, 0], [1, 0.88, 0.86]);
  ball(body, 0.255, visor, [0, 1.06, 0.16], [0.93, 0.56, 0.58]);
  for (const x of [-0.09, 0.09]) {
    ball(body, 0.034, eye, [x, 1.075, 0.298], [0.75, 1.25, 0.4]);
  }
  // 좌우 팔다리의 회전 중심을 분리해 이동 애니메이션에 사용합니다.
  const legs = [-1, 1].map((side) => {
    const leg = new THREE.Group();
    leg.position.set(side * 0.12, 0.43, 0);
    group.add(leg);
    cylinder(leg, [0.075, 0.075], 0.24, porcelain, [0, -0.12, 0]);
    ball(leg, 0.095, shoe, [0, -0.32, 0.03], [1, 0.65, 1.35]);
    return leg;
  });
  for (const side of [-1, 1]) {
    const arm = ball(body, 0.095, accent, [side * 0.29, 0.62, 0], [0.8, 1.55, 0.9]);
    arm.rotation.z = side * 0.2;
    ball(body, 0.073, porcelain, [side * 0.31, 0.46, 0.015]);
    ball(body, 0.1, accent, [side * 0.32, 1.055, 0], [0.65, 1.2, 0.95]);
  }
  const headband = mesh(
    body,
    new THREE.TorusGeometry(0.32, 0.038, 8, 24, Math.PI),
    accent,
    0,
    1.05,
    0
  );
  headband.rotation.z = 0;
  cylinder(body, [0.015, 0.015], 0.14, shoe, [0, 1.38, 0]);
  ball(body, 0.045, accent, [0, 1.48, 0]);
  const badge = box(body, [0.1, 0.09, 0.018], porcelain, [0.06, 0.71, 0.217]);
  badge.rotation.z = 0.08;
  ball(body, 0.16, accent, [0, 0.68, -0.22], [0.9, 1.1, 0.5]);
  const ring = mesh(
    group,
    new THREE.RingGeometry(0.39, 0.46, 40),
    new THREE.MeshBasicMaterial({
      color: "#6d9b89",
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    }),
    0,
    0.025,
    0
  );
  ring.rotation.x = -Math.PI / 2;
  ring.castShadow = false;
  ring.visible = false;
  body.rotation.y = ((index % 3) - 1) * 0.08;
  return { group, body, leftLeg: legs[0], rightLeg: legs[1], ring };
}
