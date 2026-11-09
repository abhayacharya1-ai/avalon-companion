export function questTeamSizes(players: number): number[] {
  const map: Record<number, number[]> = {
    5:[2,3,2,3,3], 6:[2,3,4,3,4], 7:[2,3,3,4,4],
    8:[3,4,4,5,5], 9:[3,4,4,5,5], 10:[3,4,4,5,5]
  };
  return map[players] ?? [];
}
export function failsRequired(players: number, quest: number): number {
  return players >= 7 && quest === 4 ? 2 : 1;
}
export function evaluateQuest(success: number, fail: number, players: number, quest: number) {
  return fail < failsRequired(players, quest) ? "success" : "fail";
}
export function nextLeaderIndex(current: number, count: number) {
  return (current + 1) % count;
}
