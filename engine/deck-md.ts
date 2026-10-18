// 배포용 deck.md(spec/DECK-MD.md): 덱 HTML을 Markdown으로. engine/outline.ts의 deck 모드를 쓰는 얇은 래퍼다(순수 함수).
// 발표자 노트는 공개 유출을 막으려고 기본으로 뺀다. notes: true를 줄 때만 넣는다(번들과 배포 경로는 이 옵션을 쓰지 않는다).
import { outline } from "./outline";

export function deckMarkdown(html: string, opts: { notes?: boolean } = {}): string {
  return outline(html, { notes: opts.notes === true, deck: true });
}
