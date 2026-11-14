import * as Dialog from "@radix-ui/react-dialog";

// 비모달 팝업으로 열어 바깥을 클릭하면 바로 라운지 조작을 이어갈 수 있습니다.
export function OfficeControlsHelp() {
  return (
    <Dialog.Root modal={false}>
      <Dialog.Trigger className="office-help-trigger">조작법</Dialog.Trigger>
      <Dialog.Content className="office-help-popover">
        <div className="office-help-header">
          <Dialog.Title>라운지 조작법</Dialog.Title>
          <Dialog.Close aria-label="조작법 닫기">×</Dialog.Close>
        </div>
        <Dialog.Description>
          라운지나 아래 목록에서 팀원을 클릭하면 선택하고, 더블클릭하면 대화를 열어요.
        </Dialog.Description>
        <dl>
          <dt>이동</dt>
          <dd>
            <kbd>WASD</kbd> 또는 <kbd>방향키</kbd>
          </dd>
          <dt>빠르게 이동</dt>
          <dd>
            <kbd>Shift</kbd> + 이동
          </dd>
          <dt>선택 해제</dt>
          <dd>
            <kbd>Esc</kbd>
          </dd>
          <dt>둘러보기</dt>
          <dd>마우스 드래그</dd>
          <dt>확대·축소</dt>
          <dd>마우스 휠</dd>
        </dl>
      </Dialog.Content>
    </Dialog.Root>
  );
}
