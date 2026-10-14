import { createContext, useContext } from "react";

/** 색 선택기의 덱 섹션(토큰, 이 덱의 색)이 읽는 덱 원문. 편집기가 현재 덱 전체 글자를 넣는다. 없으면 섹션은 최근 색만 보인다. */
export const DeckColorsContext = createContext<{ html: string } | null>(null);
export const useDeckHtml = () => useContext(DeckColorsContext)?.html ?? null;
