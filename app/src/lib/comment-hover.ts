import { useSyncExternalStore } from "react";

// 목록의 코멘트와 캔버스의 핀이 서로를 강조하도록 "지금 가리켜진 코멘트"를 한 곳에 둔다.
// 편집기의 React 상태로 두면 마우스가 항목을 지날 때마다 편집기 전체(코멘트 수백 개의 목록과 핀 100개)가 다시 그려져 항목당 수백 ms가 걸렸다.
let current: string | null = null;
const subs = new Set<() => void>();
export const hoveredComment = () => current;
export function setHoveredComment(id: string | null) {
  if (id === current) return;
  current = id;
  subs.forEach((f) => f());
}
export const subscribeHover = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
/** 이 코멘트가 지금 가리켜진 것인지. 바뀔 때는 그 코멘트와 이전 코멘트의 구독자만 다시 그려진다(결과가 같으면 건너뛴다). */
export const useCommentHovered = (id: string) => useSyncExternalStore(subscribeHover, () => current === id, () => false);
