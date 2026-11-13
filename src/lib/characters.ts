import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useSyncExternalStore } from "react";

import chiikawa from "@/assets/characters/chiikawa.svg";
import hachiware from "@/assets/characters/hachiware.svg";
import usagi from "@/assets/characters/usagi.svg";
import { deleteCharacter, listCharacters, saveCharacter } from "@/features/backend/api";
import type { CharacterItem } from "@/types/chat";

const builtins: Record<string, string> = {
  "builtin:chiikawa": chiikawa,
  "builtin:hachiware": hachiware,
  "builtin:usagi": usagi,
};
// 이미지가 교체된 기본 항목은 업로드 이미지로 취급합니다.
export function getBuiltinCharacterKind(image: string) {
  if (image === chiikawa || image === "builtin:chiikawa") return "chiikawa";
  if (image === hachiware || image === "builtin:hachiware") return "hachiware";
  if (image === usagi || image === "builtin:usagi") return "usagi";
  return null;
}

const browserKey = "opengem.characters.v1";
const browserDefaults: CharacterItem[] = [
  { id: "chiikawa", name: "치이카와", image: "builtin:chiikawa" },
  { id: "hachiware", name: "하치와레", image: "builtin:hachiware" },
  { id: "usagi", name: "우사기", image: "builtin:usagi" },
];

type CharacterState = { characters: CharacterItem[]; loading: boolean; error: string };
let state: CharacterState = { characters: [], loading: true, error: "" };
let rawCharacters: CharacterItem[] = [];
let started = false;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => state;
const update = (next: CharacterState) => {
  state = next;
  listeners.forEach((listener) => listener());
};
const resolveImage = (item: CharacterItem): CharacterItem => ({
  ...item,
  image: builtins[item.image] ?? item.image,
});
const readBrowser = (): CharacterItem[] => {
  const saved = localStorage.getItem(browserKey);
  return saved === null ? browserDefaults : (JSON.parse(saved) as CharacterItem[]);
};

// 라이브러리 상태를 공유해 설정과 오피스가 동시에 갱신됩니다.
export async function refreshCharacters() {
  try {
    const items = isTauri() ? await listCharacters() : readBrowser();
    rawCharacters = items;
    update({ characters: items.map(resolveImage), loading: false, error: "" });
  } catch (error) {
    update({ ...state, loading: false, error: String(error) });
    throw error;
  }
}

export async function putCharacter(input: { id?: string; name: string; image: string }) {
  const original = rawCharacters.find((item) => item.id === input.id);
  if (original && resolveImage(original).image === input.image) {
    input = { ...input, image: original.image };
  }
  let item: CharacterItem;
  if (isTauri()) {
    item = await saveCharacter(input);
  } else {
    item = { ...input, id: input.id || crypto.randomUUID() };
  }
  const items = [...rawCharacters];
  const index = items.findIndex((existing) => existing.id === item.id);
  if (index < 0) items.push(item);
  else items[index] = item;
  if (!isTauri()) localStorage.setItem(browserKey, JSON.stringify(items));
  rawCharacters = items;
  update({ characters: items.map(resolveImage), loading: false, error: "" });
}

export async function removeCharacter(id: string) {
  if (isTauri()) await deleteCharacter(id);
  const items = rawCharacters.filter((item) => item.id !== id);
  if (!isTauri()) localStorage.setItem(browserKey, JSON.stringify(items));
  rawCharacters = items;
  update({ characters: items.map(resolveImage), loading: false, error: "" });
}

export function useCharacters() {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    if (!started) {
      started = true;
      void refreshCharacters().catch(() => {});
    }
  }, []);
  return current;
}
