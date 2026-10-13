// SPEC 6.5, 6.6의 메시지와 info 형식
export type Slide = { n: number; kind: string; title: string | null; chapter: number; steps: number; notes: string };
export type Info = {
  meta: { title?: string; author?: string; date?: string; id?: string };
  slide: number; step: number; slides: Slide[]; chapters: { n: number; title: string }[];
};
export type DeckEntry = { id: string; folder: string; title: string; subtitle?: string; author?: string; date?: string; visibility?: string };
export type Pos = { slide: number; step: number };

export const deckUrl = (folder: string, query: string) => `/decks/${folder}/index.html${query}`;
