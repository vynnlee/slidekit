// slidekit_edit의 순수 부분(spec/AGENT-PRESENCE.md): old_str 유일성 적용, 슬라이드 번호와 변경 슬라이드 계산, revision.
// 파일과 SSE를 건드리지 않는다(시험이 쉽고, comments.ts와 agent-edit.ts가 둘 다 가져다 쓴다).
import { createHash } from "node:crypto";

export type Edit = { old_str: string; new_str: string };
export type Hint = { line: number; context: string };
export type Applied =
  | { ok: true; out: string; slides: number[]; excerpt: string }
  | { ok: false; error: "not_found" | "ambiguous" | "no_change" | "breaks_deck"; message: string; index: number; hints?: Hint[] };

export const MAX_EDITS = 50, MAX_STR = 200_000;
/** 파일 바이트의 sha256 앞 16자리. `shasum -a 256 <파일> | cut -c1-16`과 같다. */
export const revisionOf = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

const SECTION = /<section\b[^>]*\bdata-slide\b[^>]*>[\s\S]*?<\/section>/gi;
export const slideBodies = (html: string) => [...html.matchAll(SECTION)].map((m) => m[0]);
/** index 위치가 몇 번째 슬라이드인지(1부터). 첫 슬라이드 앞이면 1. */
export const slideOf = (html: string, index: number) => Math.max(1, [...html.matchAll(/<section\b[^>]*\bdata-slide\b/gi)].filter((m) => m.index! <= index).length);
/** 보이는 글자만 한 줄로(태그 제거, 공백 정리). */
export const visible = (html: string, n = 80) => html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

/** after에서 before에 없던(본문이 달라진) 슬라이드. 번호는 after 기준이고 슬라이드가 끼어들어 번호가 밀려도 새 슬라이드만 잡힌다. */
export function changedSlides(before: string, after: string): { slide: number; excerpt: string }[] {
  const pool = new Map<string, number>();
  const old = slideBodies(before);
  for (const b of old) pool.set(b, (pool.get(b) ?? 0) + 1);
  const out: { slide: number; excerpt: string }[] = [];
  slideBodies(after).forEach((b, i) => {
    const n = pool.get(b) ?? 0;
    if (n > 0) { pool.set(b, n - 1); return; }
    // 같은 자리의 옛 슬라이드와 앞쪽이 같은 만큼 건너뛰고 달라진 첫 글자를 발췌로 쓴다
    const o = old[i] ?? "";
    let p = 0;
    while (p < o.length && p < b.length && o[p] === b[p]) p++;
    out.push({ slide: i + 1, excerpt: visible(b.slice(Math.max(0, b.lastIndexOf(">", p) + 1))) });
  });
  return out;
}

const lineOf = (s: string, at: number) => s.slice(0, at).split("\n").length;
const clip = (s: string, n = 120) => s.replace(/\s+/g, " ").trim().slice(0, n);
function hintsAt(src: string, at: number[]): Hint[] {
  const lines = src.split("\n");
  return at.slice(0, 3).map((i) => {
    const n = lineOf(src, i);
    return { line: n, context: [lines[n - 2], lines[n - 1], lines[n]].filter((l) => l !== undefined).map((l) => clip(l)).join(" | ") };
  });
}
function occurrences(src: string, needle: string, limit = 4): number[] {
  const at: number[] = [];
  for (let i = src.indexOf(needle); i >= 0 && at.length < limit; i = src.indexOf(needle, i + 1)) at.push(i); // i+1: 겹치는 경우도 센다
  return at;
}

/** edits를 위에서부터 중간 본문에 차례로 적용한다. 하나라도 실패하면 ok:false(아무것도 쓰지 않는다). */
export function applyEdits(src: string, edits: Edit[]): Applied {
  let cur = src;
  const slides: number[] = [];
  let excerpt = "";
  for (let k = 0; k < edits.length; k++) {
    const { old_str, new_str } = edits[k];
    const fail = (error: Extract<Applied, { ok: false }>["error"], message: string, hints?: Hint[]): Applied => ({ ok: false, error, message: `edit ${k + 1}: ${message}`, index: k, ...(hints?.length ? { hints } : {}) });
    if (old_str === new_str) return fail("no_change", "old_str와 new_str이 같다");
    const at = occurrences(cur, old_str);
    if (at.length === 0) {
      // 첫 줄(없으면 앞 15자)이 있는 곳을 알려 줘서 공백이나 들여쓰기 차이를 찾게 한다
      const first = clip(old_str.split("\n").find((l) => l.trim()) ?? "", 40);
      const near = [first, first.slice(0, 15)].filter((s) => s.length >= 4).map((s) => occurrences(cur, s, 3)).find((a) => a.length) ?? [];
      return fail("not_found", "old_str가 덱에 없다(공백, 들여쓰기, 줄바꿈이 한 글자라도 다르면 찾지 못한다). 덱을 다시 읽고 그대로 복사하라", hintsAt(cur, near));
    }
    if (at.length > 1) return fail("ambiguous", `old_str가 ${at.length >= 4 ? "4번 이상" : at.length + "번"} 나온다. 앞뒤 문맥을 더 넣어 한 곳만 가리켜라`, hintsAt(cur, at));
    slides.push(slideOf(cur, at[0]));
    if (!excerpt) excerpt = visible(old_str);
    cur = cur.slice(0, at[0]) + new_str + cur.slice(at[0] + old_str.length);
  }
  if (!/data-slidekit=/.test(cur) || !/<section\b[^>]*\bdata-slide\b/.test(cur)) return { ok: false, error: "breaks_deck", message: "수정 뒤 본문에 data-slidekit 또는 <section data-slide>가 없어 거절했다", index: edits.length - 1 };
  return { ok: true, out: cur, slides, excerpt };
}
