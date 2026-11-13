import * as THREE from "three";
import { getBuiltinCharacterKind } from "@/lib/characters";
import type { CharacterItem } from "@/types/chat";
import { createImageCharacterMesh } from "./office-image-model";
import { createOfficeAvatar } from "./office-models";

type CharacterAvatarModel = ReturnType<typeof createOfficeAvatar> & {
  labelHeight: number;
  kind: "chiikawa" | "hachiware" | "usagi" | "image" | "robot";
  dispose: () => void;
};

export function createCharacterOfficeAvatar(
  character: CharacterItem | undefined,
  color: string,
  index: number,
  onChange: () => void
): CharacterAvatarModel {
  const robot = createOfficeAvatar(color, index);
  const model: CharacterAvatarModel = {
    ...robot,
    labelHeight: 1.8,
    kind: "robot",
    dispose: () => {},
  };
  if (!character) return model;

  // 저장된 원본의 윤곽과 얼굴을 사용해 캐릭터를 입체화합니다.
  let disposed = false;
  const placeholder = [...robot.body.children];
  const texture = new THREE.TextureLoader().load(
    character.image,
    (loaded) => {
      if (disposed) return;
      try {
        loaded.colorSpace = THREE.SRGBColorSpace;
        const characterMesh = createImageCharacterMesh(loaded.image as HTMLImageElement, loaded);
        placeholder.forEach((child) => {
          child.visible = false;
        });
        robot.leftLeg.visible = false;
        robot.rightLeg.visible = false;
        robot.body.add(characterMesh.group);
        model.labelHeight = characterMesh.height + 0.18;
        model.kind = getBuiltinCharacterKind(character.image) ?? "image";
      } catch {
        // 손상되거나 픽셀을 읽을 수 없는 이미지도 오피스 사용을 막지 않습니다.
        model.kind = "robot";
      }
      onChange();
    },
    undefined,
    () => {
      if (!disposed) onChange();
    }
  );
  // 로드가 끝나기 전에 화면을 나가도 콜백과 GPU 텍스처가 남지 않도록 정리합니다.
  model.dispose = () => {
    disposed = true;
    texture.dispose();
  };
  return model;
}
