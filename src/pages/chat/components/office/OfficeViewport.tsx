import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { AgentItem } from "@/types/chat";
import { useCharacters } from "@/lib/characters";
import { buildOfficeEnvironment } from "./office-models";
import { createCharacterOfficeAvatar } from "./office-character-avatars";
import { getOfficeAgentId } from "./office-identity";
import { OfficeIcon } from "./OfficeIcon";
import {
  decodeOfficePositions,
  encodeOfficePositions,
  getMovementDirection,
  getOfficeLayout,
  moveOfficeAgent,
  type OfficePositions,
} from "./office-world";

export type OfficeViewportHandle = {
  focus: () => void;
  zoom: (factor: number) => void;
  resetView: () => void;
  resetPosition: () => void;
};
type Props = {
  ref: Ref<OfficeViewportHandle>;
  agents: AgentItem[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onStartChat: (id: string) => void;
  onReady: (ready: boolean) => void;
};
const STORAGE_KEY = "opengem.office.positions.v1";
const MOVE_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ShiftLeft",
  "ShiftRight",
]);

function disposeScene(scene: THREE.Scene) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    (Array.isArray(object.material) ? object.material : [object.material]).forEach((item) =>
      materials.add(item)
    );
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

export default function OfficeViewport({
  ref,
  agents,
  selectedId,
  onSelect,
  onStartChat,
  onReady,
}: Props) {
  const { characters } = useCharacters();
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<OfficeViewportHandle | null>(null);
  const current = useRef({ selectedId, onSelect, onStartChat, onReady });
  const invalidate = useRef<(() => void) | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    current.current = { selectedId, onSelect, onStartChat, onReady };
  }, [selectedId, onSelect, onStartChat, onReady]);
  useEffect(() => {
    invalidate.current?.();
  }, [selectedId]);
  useImperativeHandle(
    ref,
    () => ({
      focus: () => api.current?.focus(),
      zoom: (factor) => api.current?.zoom(factor),
      resetView: () => api.current?.resetView(),
      resetPosition: () => api.current?.resetPosition(),
    }),
    []
  );

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "low-power",
      });
    } catch {
      setFailed(true);
      current.current.onReady(false);
      return;
    }
    setFailed(false);
    const canvas = renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "3D 에이전트 오피스");
    canvas.setAttribute(
      "aria-description",
      "에이전트를 더블클릭하면 대화가 열립니다. 한 번 클릭한 뒤 WASD 또는 방향키로 이동하세요. Escape로 선택을 해제합니다."
    );
    element.appendChild(canvas);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    const scene = new THREE.Scene();
    const layout = getOfficeLayout(agents.length);
    const centerZ = (layout.bounds.minZ + layout.bounds.maxZ) / 2;
    // 긴 방에서도 가까운 평면 뒤로 팀원이 잘리지 않도록 시점을 함께 멀리 둡니다.
    const cameraScale = Math.max(1, (layout.bounds.maxZ - layout.bounds.minZ) / 18);
    const camera = new THREE.OrthographicCamera(-10, 10, 8, -8, 0.1, 150 * cameraScale);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.enablePan = false;
    controls.minZoom = 0.7;
    controls.maxZoom = 2.3;
    controls.minPolarAngle = Math.PI / 6;
    controls.maxPolarAngle = Math.PI / 2.8;
    controls.minAzimuthAngle = -0.2;
    controls.maxAzimuthAngle = Math.PI / 2.1;
    controls.target.set(0, 0.3, centerZ);
    const resetView = () => {
      camera.position.set(12 * cameraScale, 13 * cameraScale, centerZ + 16 * cameraScale);
      camera.zoom = 1;
      camera.updateProjectionMatrix();
      controls.target.set(0, 0.3, centerZ);
      controls.update();
    };
    resetView();
    scene.add(new THREE.HemisphereLight("#fff5df", "#879a9c", 2.1));
    const sun = new THREE.DirectionalLight("#fff1d7", 2.5);
    sun.position.set(3 * cameraScale, 15 * cameraScale, 7 * cameraScale + centerZ);
    sun.target.position.set(0, 0, centerZ);
    sun.castShadow = true;
    const shadowSize = Math.max(11, (layout.bounds.maxZ - layout.bounds.minZ) / 2 + 3);
    Object.assign(sun.shadow.camera, {
      left: -shadowSize,
      right: shadowSize,
      top: shadowSize,
      bottom: -shadowSize,
      far: 65 * cameraScale,
    });
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.normalBias = 0.04;
    sun.shadow.bias = -0.0002;
    scene.add(sun, sun.target);
    scene.add(buildOfficeEnvironment(layout));

    let saved: OfficePositions = {};
    try {
      saved = decodeOfficePositions(localStorage.getItem(STORAGE_KEY), layout);
    } catch {
      /* 저장소가 막혀도 이동은 가능합니다. */
    }
    const positions: OfficePositions = {};
    const labels = document.createElement("div");
    labels.className = "office-agent-labels";
    element.appendChild(labels);
    const avatars = agents.map((agent, index) => {
      const id = getOfficeAgentId(agent, index);
      const character = characters.find((item) => item.id === agent.characterId) ?? characters[0];
      const model = createCharacterOfficeAvatar(character, agent.color, index, () => wake());
      const position = saved[id] ?? layout.spawns[index];
      positions[id] = { ...position };
      model.group.position.set(position.x, 0, position.z);
      model.group.userData.agentId = id;
      scene.add(model.group);
      const label = document.createElement("button");
      label.type = "button";
      label.className = "office-name-tag";
      label.dataset.agentId = id;
      label.textContent = agent.name;
      label.setAttribute("aria-label", agent.name + " 선택");
      label.addEventListener("click", () => {
        stopMovement();
        current.current.onSelect(id);
        canvas.focus({ preventScroll: true });
      });
      label.addEventListener("dblclick", () => current.current.onStartChat(id));
      labels.appendChild(label);
      return {
        model,
        group: model.group,
        body: model.body,
        leftLeg: model.leftLeg,
        rightLeg: model.rightLeg,
        ring: model.ring,
        id,
        label,
        index,
        characterName: character?.name,
      };
    });

    let dirty = true;
    let moved = false;
    let lost = false;
    let visible = true;
    let frameId = 0;
    let previousTime = 0;
    let lastSaved = 0;
    const keys = new Set<string>();
    const projected = new THREE.Vector3();
    const cameraDirection = new THREE.Vector3();
    const save = () => {
      if (!moved) return;
      try {
        // 다른 모드의 위치도 유지하고 현재 방에서 이동한 좌표만 덮어씁니다.
        let previous: OfficePositions = {};
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          const old = raw ? JSON.parse(raw) : null;
          if (
            old?.version === 1 &&
            old.positions &&
            typeof old.positions === "object" &&
            !Array.isArray(old.positions)
          )
            previous = old.positions;
        } catch {
          /* 손상된 JSON은 새 위치 저장으로 복구합니다. */
        }
        localStorage.setItem(STORAGE_KEY, encodeOfficePositions({ ...previous, ...positions }));
        moved = false;
      } catch {
        /* 저장 권한이나 용량이 없어도 현재 세션은 유지합니다. */
      }
    };
    const stopMovement = () => {
      keys.clear();
      save();
      dirty = true;
    };
    const wake = () => {
      dirty = true;
      if (!frameId && visible && !document.hidden && !lost)
        frameId = requestAnimationFrame(animate);
    };
    invalidate.current = () => {
      stopMovement();
      wake();
    };
    const animate = (time: number) => {
      frameId = 0;
      if (!visible || document.hidden || lost) return;
      const delta = previousTime ? (time - previousTime) / 1000 : 0;
      previousTime = time;
      controls.update();
      const selected = avatars.find((avatar) => avatar.id === current.current.selectedId);
      let walking = false;
      if (selected && document.activeElement === canvas && keys.size) {
        cameraDirection.copy(camera.position).sub(controls.target);
        const direction = getMovementDirection(keys, cameraDirection);
        const speed = keys.has("ShiftLeft") || keys.has("ShiftRight") ? 4.6 : 2.8;
        const old = positions[selected.id];
        const next = moveOfficeAgent(old, direction, delta, layout, speed);
        walking = next.x !== old.x || next.z !== old.z;
        if (walking) {
          positions[selected.id] = next;
          selected.group.position.set(next.x, 0, next.z);
          selected.group.rotation.y = Math.atan2(direction.x, direction.z);
          selected.leftLeg.rotation.x = Math.sin(time * 0.014) * 0.5;
          selected.rightLeg.rotation.x = -selected.leftLeg.rotation.x;
          selected.body.position.y = Math.abs(Math.sin(time * 0.014)) * 0.045;
          moved = true;
          dirty = true;
          if (time - lastSaved > 700) {
            save();
            lastSaved = time;
          }
        }
      }
      for (const avatar of avatars) {
        const active = avatar === selected;
        avatar.ring.visible = active;
        avatar.label.classList.toggle("is-selected", active);
        avatar.label.setAttribute("aria-pressed", String(active));
        if (!active || !walking) {
          if (avatar.leftLeg.rotation.x !== 0) dirty = true;
          avatar.leftLeg.rotation.x = 0;
          avatar.rightLeg.rotation.x = 0;
          avatar.body.position.y = 0;
        }
      }
      if (dirty) {
        const width = element.clientWidth;
        const height = element.clientHeight;
        scene.updateMatrixWorld();
        for (const avatar of avatars) {
          avatar.label.dataset.avatarKind = avatar.model.kind;
          avatar.label.title =
            avatar.model.kind === "robot"
              ? "기본 로봇"
              : avatar.characterName +
                (avatar.model.kind === "image" ? " · 이미지 기반 3D 캐릭터" : " · 3D 캐릭터");
          projected.set(0, avatar.model.labelHeight, 0);
          projected.add(avatar.group.position).project(camera);
          const inView =
            Math.abs(projected.x) < 0.96 &&
            Math.abs(projected.y) < 0.95 &&
            Math.abs(projected.z) <= 1;
          avatar.label.hidden = !inView;
          avatar.label.style.transform =
            "translate(" +
            ((projected.x + 1) * width) / 2 +
            "px," +
            ((1 - projected.y) * height) / 2 +
            "px) translate(-50%, -100%)";
        }
        renderer.render(scene, camera);
        dirty = false;
      }
      if (!frameId) frameId = requestAnimationFrame(animate);
    };
    const resize = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (!width || !height) return;
      const aspect = width / height;
      const depth = layout.bounds.maxZ - layout.bounds.minZ;
      const halfHeight = Math.max(7.4, depth * 0.4 + 2, (12 + depth * 0.6) / aspect / 2 + 1);
      camera.left = -halfHeight * aspect;
      camera.right = halfHeight * aspect;
      camera.top = halfHeight;
      camera.bottom = -halfHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      wake();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.target !== canvas ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.isComposing
      )
        return;
      if (event.code === "Escape") {
        stopMovement();
        current.current.onSelect(null);
        event.preventDefault();
        return;
      }
      if (!current.current.selectedId || !MOVE_KEYS.has(event.code)) return;
      event.preventDefault();
      keys.add(event.code);
      wake();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keys.delete(event.code);
      if (!keys.size) save();
    };
    let pointerStart: { x: number; y: number } | null = null;
    let lastClickedId: string | null = null;
    const onPointerDown = (event: PointerEvent) => {
      stopMovement();
      pointerStart =
        event.isPrimary && event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
      canvas.focus({ preventScroll: true });
    };
    const cancelDragClick = (event: MouseEvent) => {
      if (
        pointerStart &&
        Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 6
      ) {
        pointerStart = null;
        lastClickedId = null;
      }
    };
    const raycaster = new THREE.Raycaster();
    const onClick = (event: MouseEvent) => {
      cancelDragClick(event);
      if (!pointerStart || event.button !== 0) return;
      pointerStart = null;
      const rect = canvas.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          (-(event.clientY - rect.top) / rect.height) * 2 + 1
        ),
        camera
      );
      const hit = raycaster
        .intersectObjects(
          avatars.map((avatar) => avatar.group),
          true
        )
        .find(({ object }) => {
          // 숨긴 이미지 대체 모델과 선택 링은 클릭을 가로채지 않습니다.
          let candidate: THREE.Object3D | null = object;
          while (candidate) {
            if (!candidate.visible) return false;
            candidate = candidate.parent;
          }
          return true;
        });
      let object = hit?.object ?? null;
      while (object && !object.userData.agentId) object = object.parent;
      const id: string | null = object?.userData.agentId ?? null;
      if (id) {
        current.current.onSelect(id);
        // 캔버스는 모든 캐릭터가 공유하므로 두 클릭이 같은 에이전트에 맞았는지 확인합니다.
        if (event.detail === 2 && lastClickedId === id) current.current.onStartChat(id);
      }
      lastClickedId = id;
      wake();
    };
    const onVisibility = () => {
      stopMovement();
      previousTime = 0;
      if (document.hidden) {
        cancelAnimationFrame(frameId);
        frameId = 0;
      } else wake();
    };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      lost = true;
      stopMovement();
      cancelAnimationFrame(frameId);
      frameId = 0;
      setFailed(true);
      current.current.onReady(false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      previousTime = 0;
      if (!visible) {
        stopMovement();
        cancelAnimationFrame(frameId);
        frameId = 0;
      } else wake();
    });
    intersection.observe(element);
    controls.addEventListener("change", wake);
    canvas.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", stopMovement);
    canvas.addEventListener("blur", stopMovement);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", cancelDragClick);
    canvas.addEventListener("click", onClick);
    canvas.addEventListener("webglcontextlost", onContextLost);
    document.addEventListener("visibilitychange", onVisibility);
    api.current = {
      focus: () => canvas.focus({ preventScroll: true }),
      resetView: () => {
        stopMovement();
        resetView();
        wake();
      },
      zoom: (factor) => {
        camera.zoom = THREE.MathUtils.clamp(
          camera.zoom * factor,
          controls.minZoom,
          controls.maxZoom
        );
        camera.updateProjectionMatrix();
        wake();
      },
      resetPosition: () => {
        stopMovement();
        const avatar = avatars.find((item) => item.id === current.current.selectedId);
        if (!avatar) return;
        const spawn = layout.spawns[avatar.index];
        positions[avatar.id] = { ...spawn };
        avatar.group.position.set(spawn.x, 0, spawn.z);
        avatar.group.rotation.y = 0;
        moved = true;
        save();
        wake();
      },
    };
    resize();
    current.current.onReady(true);

    // StrictMode 재마운트와 화면 전환에서도 이벤트와 GPU 자원을 모두 해제합니다.
    return () => {
      stopMovement();
      cancelAnimationFrame(frameId);
      invalidate.current = null;
      api.current = null;
      current.current.onReady(false);
      observer.disconnect();
      intersection.disconnect();
      controls.removeEventListener("change", wake);
      controls.dispose();
      canvas.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", stopMovement);
      canvas.removeEventListener("blur", stopMovement);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", cancelDragClick);
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      document.removeEventListener("visibilitychange", onVisibility);
      avatars.forEach((avatar) => avatar.model.dispose());
      disposeScene(scene);
      sun.shadow.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      labels.remove();
    };
  }, [agents, characters, retry]);

  return (
    <div className="office-viewport" ref={host}>
      {failed && (
        <div className="office-fallback" role="status">
          <OfficeIcon name="cube" />
          <strong>3D 화면을 표시할 수 없어요</strong>
          <p>아래 팀원 목록에서 대화와 상세 정보를 이용할 수 있어요.</p>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            3D 다시 시도
          </button>
        </div>
      )}
    </div>
  );
}
