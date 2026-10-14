import { splitDeck } from "@/lib/deck-source";

// 덱 원문 두 개를 슬라이드 단위로 비교한다. 편집기 밖(Claude 등)에서 덱이 바뀌었을 때 어느 슬라이드가 달라졌는지 알려 주는 용도다.
// 슬라이드는 글자 그대로의 html이 같으면 같은 것으로 본다(순서만 바뀐 슬라이드는 달라진 것으로 치지 않는다).
export type DeckDiff = {
  /** 새 덱에서 달라졌거나 새로 생긴 슬라이드의 번호(0부터) */
  changed: number[];
  /** 새 덱에 없는 옛 슬라이드 수 */
  removed: number;
  /** 슬라이드 밖(머리말, 스타일, 토큰, 스크립트)이 달라졌는지 */
  outside: boolean;
};

export function diffDecks(prev: string, next: string): DeckDiff {
  const a = splitDeck(prev), b = splitDeck(next);
  const pool = new Map<string, number>();
  for (const u of a.units) pool.set(u.html, (pool.get(u.html) ?? 0) + 1);
  const changed: number[] = [];
  b.units.forEach((u, i) => {
    const left = pool.get(u.html) ?? 0;
    if (left > 0) pool.set(u.html, left - 1);
    else changed.push(i);
  });
  let removed = 0;
  for (const n of pool.values()) removed += n;
  return { changed, removed, outside: a.prefix !== b.prefix || a.suffix !== b.suffix };
}

/** "Slide 3", "Slides 3 and 5", "Slides 3, 5 and 8" 같은 짧은 문구 */
export function slidesLabel(indices: number[]): string {
  const n = indices.map((i) => i + 1);
  if (n.length === 1) return `Slide ${n[0]}`;
  if (n.length <= 4) return `Slides ${n.slice(0, -1).join(", ")} and ${n.at(-1)}`;
  return `${n.length} slides`;
}
