// slidekit unpublish의 본체. KV 접근은 ops로 주입해서(실제는 wrangler, 테스트는 가짜) 삭제 순서와 --yes 규칙을 외부 호출 없이 시험한다.
export type KvOps = {
  /** 키의 값, 없으면 null */
  get(key: string): string | null;
  /** 접두어로 키 목록 */
  list(prefix: string): string[];
  del(key: string): void;
};

/** 반환값은 종료 코드: 0 완료, 1 오류, 2 --yes 없이 목록만 보임 */
export function runUnpublish(deck: string, o: { yes: boolean; dry: boolean }, ops: KvOps | null, log: (s: string) => void = console.log): number {
  const keys = [`meta:${deck}`, `html:${deck}`]; // meta를 먼저 지운다: 중간에 멈춰도 Worker는 meta가 없으면 404를 주므로 본문(html)이 남아도 열리지 않는다
  if (o.dry || !ops) {
    log(`Dry run: would delete ${keys.join(", ")} (and rl:${deck}:* login counters if any)`); // 앱이 "Dry run:" 접두로 구분한다
    log("삭제는 하지 않았습니다.");
    return 0;
  }
  const raw = ops.get(`meta:${deck}`);
  if (raw === null) {
    const others = ops.list("meta:").map((k) => k.slice(5));
    log(`게시된 덱이 아닙니다: ${deck}. ${others.length ? `게시된 덱: ${others.join(", ")}` : "게시된 덱이 없습니다."}`);
    return 1;
  }
  let vis = "알 수 없음", title = "";
  try { const m = JSON.parse(raw); vis = m.visibility === "password" ? "비밀번호" : "공개"; title = typeof m.title === "string" ? m.title : ""; } catch { /* 깨진 meta도 지울 수 있다 */ }
  const counters = ops.list(`rl:${deck}:`);
  log(`게시 취소 대상: ${deck}${title ? ` ("${title}")` : ""}, 공개 범위 ${vis}`);
  log("지울 KV(DECKS) 키:");
  for (const k of [...keys, ...counters]) log(`  ${k}`);
  if (!o.yes) { log("\n지금은 지우지 않았습니다. 확인했다면 --yes를 붙여 다시 실행하세요."); return 2; }
  for (const k of [...keys, ...counters]) ops.del(k);
  log("\n게시를 취소했습니다. 로컬 덱과 dist 파일은 그대로입니다.");
  log(`Unpublished https://static.vynnlee.com/${deck}`); // 앱이 마지막 줄로 성공을 읽는다
  return 0;
}
