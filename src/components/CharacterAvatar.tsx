import { useState } from "react";

import { useCharacters } from "@/lib/characters";
import type { AgentItem } from "@/types/chat";

import "./CharacterAvatar.css";

type CharacterAvatarProps = {
  agent: AgentItem;
  className?: string;
};

// 삭제된 캐릭터나 읽을 수 없는 이미지는 기본 캐릭터 또는 아이콘으로 대체합니다.
export function CharacterAvatar({ agent, className }: CharacterAvatarProps) {
  const { characters } = useCharacters();
  const character = characters.find((item) => item.id === agent.characterId) ?? characters[0];
  const [failedImage, setFailedImage] = useState<string | null>(null);

  if (!character || failedImage === character.image) {
    return (
      <span className={className} aria-hidden="true">
        <span className="material-symbols-outlined">{agent.icon}</span>
      </span>
    );
  }

  return (
    <img
      className={className}
      src={character.image}
      alt=""
      onError={() => setFailedImage(character.image)}
    />
  );
}
