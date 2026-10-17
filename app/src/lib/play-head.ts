// 재생 헤드: React 상태가 아니라 작은 저장소다. 헤드를 옮길 때 편집기 전체가 다시 그려지지 않고, 구독한 캔버스와 타임라인만 갱신한다.
// k: 단계(1 = 처음 상태, 클릭 c 뒤 = c + 1), null이면 마지막 단계. scrub이 있으면 클릭 click의 시작부터 t(ms)만큼 지난 전환 중간 프레임을 보인다.
export type Scrub = { click: number; t: number };
export type Head = { k: number | null; animate: boolean; scrub?: Scrub | null };
export type PlayHead = { get(): Head; set(h: Head): void; subscribe(f: () => void): () => void };

export function createHead(): PlayHead {
  let v: Head = { k: null, animate: false };
  const subs = new Set<() => void>();
  return { get: () => v, set(h) { v = h; subs.forEach((f) => f()); }, subscribe(f) { subs.add(f); return () => { subs.delete(f); }; } };
}
