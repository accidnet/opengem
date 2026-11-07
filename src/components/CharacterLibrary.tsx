import { useRef, useState, type ChangeEvent, type FormEvent } from "react";

import { putCharacter, refreshCharacters, removeCharacter, useCharacters } from "@/lib/characters";
import type { CharacterItem } from "@/types/chat";

import "./CharacterLibrary.css";

type CharacterLibraryProps = { onRemoved: (id: string) => void };
const MAX_IMAGE_SIZE = 2 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export function CharacterLibrary({ onRemoved }: CharacterLibraryProps) {
  const { characters, loading, error: loadError } = useCharacters();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState(false);
  const [fileKey, setFileKey] = useState(0);
  const readVersion = useRef(0);

  const reset = () => {
    readVersion.current += 1;
    setReading(false);
    setFileError(false);
    setEditing(null);
    setName("");
    setImage("");
    setError("");
    setFileKey((key) => key + 1);
  };
  const edit = (character: CharacterItem) => {
    readVersion.current += 1;
    setReading(false);
    setFileError(false);
    setEditing(character.id);
    setName(character.name);
    setImage(character.image);
    setError("");
    setFileKey((key) => key + 1);
  };
  const chooseImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const version = ++readVersion.current;
    setReading(false);
    if (!IMAGE_TYPES.includes(file.type) || file.size > MAX_IMAGE_SIZE) {
      setFileError(true);
      setError("PNG, JPEG, WebP 또는 GIF 이미지를 2MB 이하로 선택해 주세요.");
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    setReading(true);
    reader.onload = () => {
      if (readVersion.current !== version) return;
      setReading(false);
      if (typeof reader.result === "string") {
        setImage(reader.result);
        setFileError(false);
        setError("");
      }
    };
    reader.onerror = () => {
      if (readVersion.current !== version) return;
      setReading(false);
      setFileError(true);
      setError("이미지를 읽지 못했어요. 다시 선택해 주세요.");
    };
    reader.readAsDataURL(file);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (loading || loadError || reading || fileError) return;
    if (!name.trim() || name.trim().length > 80 || !image) {
      setError("캐릭터 이름(80자 이하)과 이미지를 입력해 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await putCharacter({ id: editing ?? undefined, name: name.trim(), image });
      reset();
    } catch (cause) {
      setError(`저장하지 못했어요: ${String(cause)}`);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (character: CharacterItem) => {
    if (
      !window.confirm(
        `'${character.name}' 캐릭터를 삭제할까요? 사용 중인 에이전트는 기본 캐릭터로 표시됩니다.`
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await removeCharacter(character.id);
      onRemoved(character.id);
      if (editing === character.id) reset();
    } catch (cause) {
      setError(`삭제하지 못했어요: ${String(cause)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="character-library">
      <div className="panel-modal-main-copy">
        <h4>캐릭터 관리</h4>
        <p>
          이미지를 추가하거나 이름과 이미지를 변경하고, 필요 없는 캐릭터를 삭제하세요. 이 변경은
          즉시 저장됩니다.
        </p>
      </div>
      <section className="settings-card character-library-list" aria-label="캐릭터 라이브러리">
        {loading && <p>캐릭터를 불러오는 중이에요.</p>}
        {loadError && (
          <p role="alert">
            캐릭터를 불러오지 못했어요: {loadError}{" "}
            <button type="button" onClick={() => void refreshCharacters().catch(() => {})}>
              다시 시도
            </button>
          </p>
        )}
        {!loading && !loadError && characters.length === 0 && (
          <p>캐릭터가 없어요. 아래에서 이미지를 추가해 주세요.</p>
        )}
        {characters.map((character) => (
          <div className="character-library-item" key={character.id}>
            <img src={character.image} alt="" />
            <strong>{character.name}</strong>
            <button
              className="settings-secondary-btn"
              type="button"
              disabled={busy}
              onClick={() => edit(character)}
              aria-label={`${character.name} 수정`}
            >
              수정
            </button>
            <button
              className="settings-secondary-btn"
              type="button"
              disabled={busy}
              onClick={() => void remove(character)}
              aria-label={`${character.name} 삭제`}
            >
              삭제
            </button>
          </div>
        ))}
      </section>
      <form className="settings-card character-library-form" onSubmit={(event) => void save(event)}>
        <div className="settings-card-head">
          <div>
            <h4>{editing ? "캐릭터 수정" : "캐릭터 추가"}</h4>
            <p>PNG, JPEG, WebP, GIF · 최대 2MB</p>
          </div>
        </div>
        <label className="settings-field">
          <span>이름</span>
          <input
            className="settings-input"
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="settings-field">
          <span>이미지 {editing && "(변경할 때만 선택)"}</span>
          <input
            key={fileKey}
            className="settings-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={chooseImage}
          />
        </label>
        {image && (
          <img className="character-library-preview" src={image} alt="선택한 캐릭터 미리보기" />
        )}
        {error && (
          <p className="settings-error" role="alert">
            {error}
          </p>
        )}
        <div className="character-library-actions">
          {editing && (
            <button
              className="settings-secondary-btn"
              type="button"
              onClick={reset}
              disabled={busy}
            >
              수정 취소
            </button>
          )}
          <button
            className="settings-primary-btn"
            type="submit"
            disabled={busy || reading || fileError || loading || Boolean(loadError)}
          >
            {editing ? "변경 저장" : "캐릭터 추가"}
          </button>
        </div>
      </form>
    </div>
  );
}
