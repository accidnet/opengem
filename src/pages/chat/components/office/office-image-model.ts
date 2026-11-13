import * as THREE from "three";

const ALPHA_THRESHOLD = 32;

function dominantFurColor(pixels: Uint8ClampedArray) {
  const bins = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    if (pixels[i + 3] < 200 || (r + g + b) / 3 < 90) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bin = bins.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bin.count++;
    bin.r += r;
    bin.g += g;
    bin.b += b;
    bins.set(key, bin);
  }
  const dominant = [...bins.values()].sort((a, b) => b.count - a.count)[0];
  if (!dominant) return new THREE.Color("#f6eee1");
  return new THREE.Color().setRGB(
    dominant.r / dominant.count / 255,
    dominant.g / dominant.count / 255,
    dominant.b / dominant.count / 255,
    THREE.SRGBColorSpace
  );
}

// PNG의 실제 외곽과 얼굴을 보존하면서 경계에서 안쪽으로 부풀린 닫힌 입체를 만듭니다.
export function createImageCharacterMesh(image: HTMLImageElement, texture: THREE.Texture) {
  const imageWidth = image.naturalWidth || image.width;
  const imageHeight = image.naturalHeight || image.height;
  if (!imageWidth || !imageHeight) throw new Error("캐릭터 이미지 크기를 읽을 수 없어요.");
  const canvas = document.createElement("canvas");
  const analysisScale = Math.min(1, 768 / Math.max(imageWidth, imageHeight));
  canvas.width = Math.max(1, Math.round(imageWidth * analysisScale));
  canvas.height = Math.max(1, Math.round(imageHeight * analysisScale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("캐릭터 이미지 윤곽을 읽을 수 없어요.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const analysis = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (analysis[(y * canvas.width + x) * 4 + 3] < ALPHA_THRESHOLD) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) throw new Error("캐릭터 이미지가 모두 투명해요.");
  // 투명 여백만 잘라내고 원본 좌표로 UV를 계산해 얼굴의 비율을 유지합니다.
  minX = Math.max(0, minX - 1);
  minY = Math.max(0, minY - 1);
  maxX = Math.min(canvas.width - 1, maxX + 1);
  maxY = Math.min(canvas.height - 1, maxY + 1);
  const cropX = (minX / canvas.width) * imageWidth;
  const cropY = (minY / canvas.height) * imageHeight;
  const cropWidth = ((maxX - minX + 1) / canvas.width) * imageWidth;
  const cropHeight = ((maxY - minY + 1) / canvas.height) * imageHeight;
  const aspect = cropWidth / cropHeight;
  const sampleScale = 144 / Math.max(cropWidth, cropHeight);
  const columns = Math.max(2, Math.round(cropWidth * sampleScale));
  const rows = Math.max(2, Math.round(cropHeight * sampleScale));
  canvas.width = columns;
  canvas.height = rows;
  context.drawImage(image, cropX, cropY, cropWidth, cropHeight, 0, 0, columns, rows);
  const pixels = context.getImageData(0, 0, columns, rows).data;
  const mask = new Uint8Array(columns * rows);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = pixels[i * 4 + 3] >= ALPHA_THRESHOLD ? 1 : 0;
  }
  // 축소하면서 사라진 얇은 이미지도 빈 모델 대신 기본 캐릭터로 표시합니다.
  if (!mask.some((value) => value > 0)) throw new Error("입체화할 이미지 윤곽이 너무 작아요.");
  const occupied = (x: number, y: number) =>
    x >= 0 && x < columns && y >= 0 && y < rows ? mask[y * columns + x] : 0;
  const stride = columns + 1;
  const total = stride * (rows + 1);
  const active = new Uint8Array(total);
  const distance = new Float32Array(total);
  for (let y = 0; y <= rows; y++) {
    for (let x = 0; x <= columns; x++) {
      const count =
        occupied(x - 1, y - 1) + occupied(x, y - 1) + occupied(x - 1, y) + occupied(x, y);
      const i = y * stride + x;
      active[i] = count > 0 ? 1 : 0;
      distance[i] = count === 4 ? Infinity : 0;
    }
  }
  // 대각선까지 포함한 경계 거리로 가는 귀는 얇게, 몸통은 둥글게 부풀립니다.
  const diagonal = Math.SQRT2;
  for (let y = 1; y <= rows; y++) {
    for (let x = 1; x <= columns; x++) {
      const i = y * stride + x;
      distance[i] = Math.min(
        distance[i],
        distance[i - 1] + 1,
        distance[i - stride] + 1,
        distance[i - stride - 1] + diagonal,
        x < columns ? distance[i - stride + 1] + diagonal : Infinity
      );
    }
  }
  for (let y = rows - 1; y >= 0; y--) {
    for (let x = columns - 1; x >= 0; x--) {
      const i = y * stride + x;
      distance[i] = Math.min(
        distance[i],
        distance[i + 1] + 1,
        distance[i + stride] + 1,
        distance[i + stride + 1] + diagonal,
        x > 0 ? distance[i + stride - 1] + diagonal : Infinity
      );
    }
  }
  let maxDistance = 1;
  for (const value of distance)
    if (Number.isFinite(value)) maxDistance = Math.max(maxDistance, value);
  const height = Math.min(1.95, 1.5 / aspect);
  const width = height * aspect;
  const thickness = Math.min(width * 0.23, height * 0.2);
  // 거리장의 능선과 픽셀 경계가 얼굴에 주름처럼 보이지 않게 곡면을 부드럽게 만듭니다.
  let depths = new Float32Array(total);
  const horizontal = new Float32Array(total);
  let blurred = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    depths[i] = thickness * Math.sqrt(Math.min(1, distance[i] / maxDistance));
  }
  for (let pass = 0; pass < 24; pass++) {
    for (let y = 0; y <= rows; y++) {
      for (let x = 0; x <= columns; x++) {
        const i = y * stride + x;
        horizontal[i] =
          ((x > 0 ? depths[i - 1] : 0) + 2 * depths[i] + (x < columns ? depths[i + 1] : 0)) / 4;
      }
    }
    for (let y = 0; y <= rows; y++) {
      for (let x = 0; x <= columns; x++) {
        const i = y * stride + x;
        blurred[i] =
          ((y > 0 ? horizontal[i - stride] : 0) +
            2 * horizontal[i] +
            (y < rows ? horizontal[i + stride] : 0)) /
          4;
      }
    }
    [depths, blurred] = [blurred, depths];
  }
  const positions: number[] = [];
  const uvs: number[] = [];
  const front = new Int32Array(total).fill(-1);
  const back = new Int32Array(total).fill(-1);
  for (let y = 0; y <= rows; y++) {
    for (let x = 0; x <= columns; x++) {
      const i = y * stride + x;
      if (!active[i]) continue;
      // 실루엣은 그대로 두고 가장자리 5픽셀만 둥글게 접어 닫힌 측면으로 연결합니다.
      const edgeDistance = Math.min(1, distance[i] / 5);
      const edgeRoundness = Math.sqrt(1 - Math.pow(1 - edgeDistance, 2));
      const depth = 0.012 + depths[i] * edgeRoundness;
      const px = (x / columns - 0.5) * width;
      const py = (1 - y / rows) * height + 0.04;
      const u = (cropX + (x / columns) * cropWidth) / imageWidth;
      const v = 1 - (cropY + (y / rows) * cropHeight) / imageHeight;
      front[i] = positions.length / 3;
      positions.push(px, py, depth);
      uvs.push(u, v);
      back[i] = positions.length / 3;
      positions.push(px, py, -depth);
      uvs.push(u, v);
    }
  }
  const faceIndices: number[] = [];
  const reverseIndices: number[] = [];
  const closeEdge = (a: number, b: number) => {
    reverseIndices.push(front[a], back[a], front[b], front[b], back[a], back[b]);
  };
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      if (!occupied(x, y)) continue;
      const a = y * stride + x;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      faceIndices.push(front[a], front[c], front[b], front[b], front[c], front[d]);
      reverseIndices.push(back[a], back[b], back[c], back[b], back[d], back[c]);
      // 외곽과 구멍의 모든 경계를 닫아 옆과 뒤에서도 실제 두께가 보이게 합니다.
      if (!occupied(x - 1, y)) closeEdge(a, c);
      if (!occupied(x + 1, y)) closeEdge(d, b);
      if (!occupied(x, y - 1)) closeEdge(b, a);
      if (!occupied(x, y + 1)) closeEdge(c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex([...faceIndices, ...reverseIndices]);
  geometry.addGroup(0, faceIndices.length, 0);
  geometry.addGroup(faceIndices.length, reverseIndices.length, 1);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const frontMaterial = new THREE.MeshStandardMaterial({
    map: texture,
    color: "#ffffff",
    alphaTest: 0.08,
    roughness: 0.86,
  });
  const backMaterial = new THREE.MeshStandardMaterial({
    color: dominantFurColor(pixels),
    roughness: 0.86,
  });
  const mesh = new THREE.Mesh(geometry, [frontMaterial, backMaterial]);
  mesh.name = "source-character-volume";
  mesh.castShadow = true;
  // 얼굴에 자기 그림자 얼룩이 생기지 않게 바닥에 드리우는 그림자만 유지합니다.
  mesh.receiveShadow = false;
  const group = new THREE.Group();
  group.add(mesh);
  return { group, height: height + 0.04 };
}
