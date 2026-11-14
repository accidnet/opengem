// 앱 공통 지침 뒤에 현재 실행 방식의 도구와 출력 규칙을 둡니다.
export function withGlobalPrompt(globalPrompt: string, instructions: string): string {
  const prompt = globalPrompt.trim();
  return prompt ? `앱 전역 프롬프트\n${prompt}\n\n${instructions}` : instructions;
}
