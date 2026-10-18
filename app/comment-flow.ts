// 코멘트 자동 처리 폭주 방지(spec/COMMENT-FLOOD.md): 시간당 전달 상한과 사용자의 Pause. 계산과 파일만 다루고 서버 상태는 comments.ts가 쥔다.
import { readFileSync, renameSync, writeFileSync } from "node:fs";

export const WINDOW = 3_600_000;
export type Flow = { paused: boolean; limit: number; used: number; remaining: number | null; resetAt: string | null; reason: "user" | "limit" | null };

/** 시간당 상한(기본 60). SLIDEKIT_COMMENT_HOURLY=0이면 끈다. 숫자가 아니면 기본값. */
export const hourlyLimit = () => { const n = Number(process.env.SLIDEKIT_COMMENT_HOURLY ?? 60); return Number.isInteger(n) && n >= 0 ? n : 60; };

/** deliveredAt 목록(모든 덱)에서 최근 60분 사용량과 상태를 계산한다. */
export function flowOf(deliveredAt: (string | undefined)[], paused: boolean, now = Date.now(), limit = hourlyLimit()): Flow {
  const times = deliveredAt.map((s) => (s ? Date.parse(s) : NaN)).filter((t) => Number.isFinite(t) && t > now - WINDOW && t <= now + 60_000).sort((a, b) => a - b);
  const used = times.length, full = limit > 0 && used >= limit;
  return {
    paused, limit, used,
    remaining: limit > 0 ? Math.max(0, limit - used) : null,
    resetAt: full ? new Date(times[used - limit] + WINDOW).toISOString() : null, // 한 자리가 비려면 (used-limit+1)번째로 오래된 전달이 60분을 채워야 한다
    reason: paused ? "user" : full ? "limit" : null,
  };
}

export const readPaused = (file: string): boolean => { try { return JSON.parse(readFileSync(file, "utf8"))?.paused === true; } catch { return false; } }; // 없거나 깨졌으면 멈춤 아님
export function writePaused(file: string, paused: boolean) {
  const tmp = `${file}.tmp-${crypto.randomUUID().slice(0, 8)}`;
  writeFileSync(tmp, JSON.stringify({ paused }), { mode: 0o600 });
  renameSync(tmp, file);
}
