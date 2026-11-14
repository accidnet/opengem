import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { putCharacter, removeCharacter, useCharacters } from "@/lib/characters";
import { AgentOffice } from "@/pages/chat/components/office/AgentOffice";
import type { AgentItem } from "@/types/chat";
import "./fixture.css";

const team: AgentItem[] = Array.from({ length: 12 }, (_, index) => ({
  agentId: "office-agent-" + (index + 1),
  characterId: ["chiikawa", "hachiware", "usagi"][index % 3],
  name: ["Orchestrator", "Frontend", "Backend"][index] ?? "Agent " + (index + 1),
  icon: "smart_toy",
  color: (["indigo", "emerald", "amber", "rose"] as const)[index % 4],
  active: index !== 2,
  role: index === 0 ? "main" : "sub",
  status: index === 2 ? "Offline" : "Active",
}));

// 독립 테스트 진입점은 이 파일에서 직접 마운트합니다.
// eslint-disable-next-line react-refresh/only-export-components
function Fixture() {
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(3);
  const [generation, setGeneration] = useState(0);
  const [reversed, setReversed] = useState(false);
  const [detail, setDetail] = useState("");
  const [chat, setChat] = useState("");
  const [firstCharacter, setFirstCharacter] = useState("chiikawa");
  const { characters } = useCharacters();
  const agents = useMemo(() => {
    const members = team
      .slice(0, count)
      .map((agent, index) => (index === 0 ? { ...agent, characterId: firstCharacter } : agent));
    return reversed ? members.reverse() : members;
  }, [count, reversed, firstCharacter]);
  // 공유 저장소를 통해 이미지를 바꿔 실제 라이브러리의 갱신 경로를 검증합니다.
  const replaceCharacterImage = async (broken = false) => {
    const image = document.createElement("canvas");
    image.width = image.height = 64;
    const context = image.getContext("2d")!;
    context.fillStyle = "#f000cc";
    context.fillRect(0, 0, 64, 64);
    context.fillStyle = "#ffffff";
    context.fillRect(16, 16, 32, 32);
    await putCharacter({
      id: "chiikawa",
      name: "테스트 이미지",
      image: broken ? "data:image/png;base64,broken" : image.toDataURL("image/png"),
    });
  };
  return (
    <main className="fixture">
      <AgentOffice
        key={generation}
        modeName="Orchestration"
        agents={agents}
        selectedAgentIndex={null}
        isConversationBusy={busy}
        onSelectAgent={(index) => setDetail(agents[index].name)}
        onStartChat={(index) => setChat(agents[index].name)}
      />
      <section className="fixture-controls" aria-label="테스트 제어">
        <input aria-label="다른 입력창" placeholder="키보드 입력 확인" />
        <label>
          <input
            type="checkbox"
            checked={busy}
            onChange={(event) => setBusy(event.target.checked)}
          />
          대화 처리 중
        </label>
        <label>
          팀 규모{" "}
          <select
            aria-label="팀 규모"
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
          >
            <option value={0}>0명</option>
            <option value={1}>1명</option>
            <option value={3}>3명</option>
            <option value={12}>12명</option>
          </select>
        </label>
        <button onClick={() => setGeneration((value) => value + 1)}>오피스 다시 열기</button>
        <button onClick={() => setReversed((value) => !value)}>목록 순서 바꾸기</button>
        <label>
          첫 팀원 캐릭터
          <select
            aria-label="첫 팀원 캐릭터"
            value={firstCharacter}
            onChange={(event) => setFirstCharacter(event.target.value)}
          >
            <option value="chiikawa">치이카와</option>
            <option value="hachiware">하치와레</option>
            <option value="usagi">우사기</option>
          </select>
        </label>
        <button onClick={() => void replaceCharacterImage()}>캐릭터 이미지 교체</button>
        <button onClick={() => void replaceCharacterImage(true)}>깨진 캐릭터 이미지</button>
        <button onClick={() => void removeCharacter("chiikawa")}>치이카와 삭제</button>
        <button
          onClick={async () => {
            for (const character of characters) await removeCharacter(character.id);
          }}
        >
          캐릭터 라이브러리 비우기
        </button>
        <output aria-label="상세 콜백">{detail || "없음"}</output>
        <output aria-label="대화 콜백">{chat || "없음"}</output>
      </section>
    </main>
  );
}

// 개발 앱과 같은 StrictMode로 렌더러와 입력 이벤트의 해제를 검증합니다.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Fixture />
  </StrictMode>
);
