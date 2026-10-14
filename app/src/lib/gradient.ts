// linear-gradient() 값을 읽고 쓴다. 채우기 편집기(Inspector의 요소 Fill, 슬라이드 Background)가 쓴다.
// 저장 형태는 언제나 `linear-gradient(<각도>deg, <색> <위치>%, ...)`다(엔진 렌더, PDF, 번들 모두 같은 표준 CSS). 색은 hex, rgb(), hsl(), 이름 색, var(--토큰) 무엇이든 그대로 둔다.
export type Stop = { color: string; pos: number };
export type Gradient = { angle: number; stops: Stop[] };

export const MAX_STOPS = 4;
const DIRS: Record<string, number> = { "to top": 0, "to right": 90, "to bottom": 180, "to left": 270 };

// 괄호 깊이 0의 쉼표로 자른다(rgb(1, 2, 3)과 var(--a, #fff) 안의 쉼표는 지킨다)
function splitTop(v: string): string[] {
  const out: string[] = []; let d = 0, cur = "";
  for (const c of v) {
    if (c === "(") d++; else if (c === ")") d--;
    if (c === "," && d === 0) { out.push(cur.trim()); cur = ""; } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** 읽을 수 없으면(radial, conic, px 위치, 스톱 1개 이하 등) null */
export function parseGradient(css: string): Gradient | null {
  const m = /^linear-gradient\(([\s\S]*)\)$/i.exec(css.trim());
  if (!m) return null;
  const parts = splitTop(m[1]);
  let angle = 180;
  const first = parts[0].toLowerCase();
  if (/^-?[\d.]+deg$/.test(first)) { angle = parseFloat(first); parts.shift(); }
  else if (first in DIRS) { angle = DIRS[first]; parts.shift(); }
  else if (/^to\s|^-?[\d.]+(turn|rad|grad)$/.test(first)) return null;
  if (parts.length < 2) return null;
  const raw = parts.map((p) => {
    const pm = /^(.*?)\s+(-?[\d.]+)%$/.exec(p);
    if (pm) return { color: pm[1].trim(), pos: parseFloat(pm[2]) };
    if (/\s-?[\d.]+(px|em|rem|vw|vh)$/.test(p)) return null; // 길이 위치는 다루지 않는다
    return { color: p, pos: NaN };
  });
  if (raw.some((s) => s === null)) return null;
  const stops = raw as Stop[];
  stops.forEach((s, i) => { if (Number.isNaN(s.pos)) s.pos = Math.round((i / (stops.length - 1)) * 100); });
  return { angle: ((angle % 360) + 360) % 360, stops };
}

export function serializeGradient(g: Gradient): string {
  const r = (n: number) => Math.round(n * 10) / 10;
  return `linear-gradient(${r(g.angle)}deg, ${g.stops.map((s) => `${s.color} ${r(s.pos)}%`).join(", ")})`;
}

/** pos(%)에서 가장 가까운 스톱의 색(새 스톱의 처음 색) */
export function colorNear(g: Gradient, pos: number): string {
  return g.stops.reduce((best, s) => (Math.abs(s.pos - pos) < Math.abs(best.pos - pos) ? s : best), g.stops[0]).color;
}

/** 위치를 0..100으로 자르고 스톱을 위치순으로 정렬한다. 선택한 스톱의 새 번호를 함께 돌려준다. */
export function normalize(g: Gradient, selected: number): { g: Gradient; selected: number } {
  const tagged = g.stops.map((s, i) => ({ s: { ...s, pos: Math.max(0, Math.min(100, s.pos)) }, i }));
  tagged.sort((a, b) => a.s.pos - b.s.pos || a.i - b.i);
  return { g: { ...g, stops: tagged.map((t) => t.s) }, selected: tagged.findIndex((t) => t.i === selected) };
}

/** 스톱 추가(최대 MAX_STOPS). 가까운 색으로 시작한다. */
export function addStop(g: Gradient, pos: number): { g: Gradient; selected: number } | null {
  if (g.stops.length >= MAX_STOPS) return null;
  return normalize({ ...g, stops: [...g.stops, { color: colorNear(g, pos), pos }] }, g.stops.length);
}

/** 스톱 삭제(최소 2개 유지) */
export function removeStop(g: Gradient, i: number): Gradient | null {
  return g.stops.length <= 2 ? null : { ...g, stops: g.stops.filter((_, k) => k !== i) };
}
