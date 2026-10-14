// 리허설 기록: 덱마다 최근 5회의 총 시간과 슬라이드별 머문 시간(초)을 localStorage에만 둔다.
const KEY = "slidekit:rehearsals";
export type Run = { t: number; total: number; dwell: Record<number, number> };
type All = Record<string, Run[]>;

const read = (): All => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? "{}"); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; } };

export const lastRun = (deck: string): Run | undefined => read()[deck]?.[0];

/** 직전 기록을 돌려주고 이번 기록을 맨 앞에 저장한다. 5초 미만은 기록하지 않는다. */
export function saveRun(deck: string, run: Run): Run | undefined {
  const all = read(), prev = all[deck]?.[0];
  if (run.total < 5) return prev;
  all[deck] = [run, ...(all[deck] ?? [])].slice(0, 5);
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch {}
  return prev;
}
