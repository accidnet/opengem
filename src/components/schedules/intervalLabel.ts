export function intervalLabel(minutes: number) {
  if (minutes === 60) return "매시간";
  if (minutes === 1440) return "매일";
  if (minutes === 10080) return "매주";
  return minutes + "분마다";
}
