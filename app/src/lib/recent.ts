// 최근 연 덱(편집기나 발표자 화면을 연 것). localStorage에만 두고 최대 8개.
const KEY = "slidekit:recent";
export type Recent = { id: string; t: number }[];

export function readRecent(): Recent {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => x && typeof x.id === "string" && typeof x.t === "number") : [];
  } catch { return []; }
}
export function recordRecent(id: string) {
  try { localStorage.setItem(KEY, JSON.stringify([{ id, t: Date.now() }, ...readRecent().filter((r) => r.id !== id)].slice(0, 8))); } catch {}
}
