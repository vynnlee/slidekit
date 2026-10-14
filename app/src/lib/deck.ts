// SPEC 6.5, 6.6의 메시지와 info 형식
export type Slide = { n: number; kind: string; title: string | null; chapter: number; steps: number; notes: string };
export type Info = {
  meta: { title?: string; author?: string; date?: string; id?: string };
  slide: number; step: number; slides: Slide[]; chapters: { n: number; title: string }[];
};
export type DeckEntry = { id: string; folder: string; title: string; subtitle?: string; author?: string; date?: string; visibility?: string; slides?: number; modified?: string };
export type Pos = { slide: number; step: number };

export const deckUrl = (folder: string, query: string) => `/decks/${folder}/index.html${query}`;

// app/comments.ts의 Comment와 같은 모양
export type Comment = {
  id: string; slide: number; path: string; excerpt: string; text: string;
  status: "open" | "done"; reply?: string; createdAt: string; repliedAt?: string;
  slideDeleted?: boolean;
  deliveredAt?: string; ackAt?: string; resolved?: boolean; resolvedAt?: string; trusted?: boolean;
};
