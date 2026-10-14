// 덱 썸네일은 덱 전체를 iframe으로 불러서 비싸다. 동시에 로드하는 수를 제한하고, 화면에서 멀어지면 해제한다.
const MAX = 3; // 동시 로드 상한(8GB 기계에서 첫 화면이 한꺼번에 CPU를 쓰지 않게)
let active = 0, paused = false;
const waiters: (() => void)[] = [];

/** 검색창 같은 오버레이가 열려 있는 동안 새 로드를 미룬다(같은 출처 iframe은 부모와 메인 스레드를 나눠 쓴다). */
export function pauseThumbs(v: boolean) {
  paused = v;
  while (!paused && active < MAX && waiters.length) waiters.shift()!();
}

/** 슬롯을 받으면 grant(release)를 부른다. 반환값은 대기 취소. release는 로드가 끝나거나 해제될 때 부른다(여러 번 불러도 안전). */
export function acquireThumb(grant: (release: () => void) => void): () => void {
  let done = false, queued = true;
  const release = () => { if (done) return; done = true; active--; if (!paused) waiters.shift()?.(); };
  const go = () => { queued = false; active++; grant(release); };
  if (active < MAX && !paused) go(); else waiters.push(go);
  return () => { if (queued) { const i = waiters.indexOf(go); if (i >= 0) waiters.splice(i, 1); queued = false; } else release(); };
}
