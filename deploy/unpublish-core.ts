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
  const keys = [`html:${deck}`, `meta:${deck}`]; // html을 먼저 지운다: meta만 남아도 Worker는 404이고, 반대로는 공개 범위가 풀린 채 본문이 남는다
  if (o.dry || !ops) {
    log(`DRY RUN: 덱 ${deck}의 게시를 취소하면 KV(DECKS)에서 다음을 지웁니다.`);
    for (const k of keys) log(`  ${k}`);
    log(`  rl:${deck}:* (로그인 시도 제한 카운터, 있으면)`);
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
  log(`\n게시를 취소했습니다: https://static.vynnlee.com/${deck} 은 이제 404입니다. 로컬 덱과 dist 파일은 그대로입니다.`);
  return 0;
}
