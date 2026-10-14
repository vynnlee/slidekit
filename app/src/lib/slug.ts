// 제목에서 폴더 이름(영문 소문자, 숫자, -)을 제안한다. 한글만 있으면 날짜로 대신한다.
export function slugify(title: string, now = new Date()) {
  const s = title.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || `deck-${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
}
export const FOLDER_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
