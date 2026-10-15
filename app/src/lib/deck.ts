// SPEC 6.5, 6.6의 메시지와 info 형식
export type Slide = { n: number; kind: string; title: string | null; chapter: number; steps: number; notes: string };
export type Info = {
  meta: { title?: string; author?: string; date?: string; id?: string };
  slide: number; step: number; slides: Slide[]; chapters: { n: number; title: string }[];
};
export type DeckEntry = { id: string; folder: string; title: string; subtitle?: string; author?: string; date?: string; visibility?: string; slides?: number; modified?: string };
export type Pos = { slide: number; step: number };

export const deckUrl = (folder: string, query: string) => `/decks/${folder}/index.html${query}`;

// 영역 코멘트의 사각형: 슬라이드(1920x1080) 기준 0 에서 1(app/capture.ts의 Region과 같다)
export type Region = { x: number; y: number; w: number; h: number };

// app/comments.ts의 Comment와 같은 모양
export type Comment = {
  id: string; slide: number; path: string; excerpt: string; text: string;
  status: "open" | "done"; reply?: string; createdAt: string; repliedAt?: string;
  slideDeleted?: boolean; recheck?: boolean; held?: boolean;
  region?: Region; overlap?: string[]; step?: number; image?: "pending" | "ready" | "failed"; // 영역 코멘트(코멘트 모드)
  deliveredAt?: string; ackAt?: string; resolved?: boolean; resolvedAt?: string; trusted?: boolean;
  editBase?: string; editHash?: string; revertedAt?: string; revertUndo?: string; // Claude의 수정 되돌리기(서버가 답이 달릴 때 연결)
};
