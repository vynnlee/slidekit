// 덱 폴더 이름 검증을 한 곳에 둔다(comments.ts, editor-api.ts, decks-api.ts가 같은 규칙을 쓴다).
// 규칙: 영숫자나 _로 시작하고 영숫자와 _ . -만 쓰며(점으로 시작하는 .trash 같은 폴더 제외, 슬래시 불가),
// decks/<이름>이 실제 디렉터리이고 index.html이 있으며 심볼릭 링크로 decks/ 밖을 가리키지 않아야 한다.
import { existsSync, realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";

export const decksDir = process.env.SLIDEKIT_DECKS ?? join(import.meta.dir, "..", "decks"); // 테스트는 임시 폴더를 쓴다
export const FOLDER = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

export const isFolderName = (f: unknown): f is string => typeof f === "string" && FOLDER.test(f) && !f.includes("..");

/** 유효한 덱 폴더이면 절대 경로를, 아니면 null. needIndex=false면 index.html이 없어도 된다(코멘트처럼 폴더만 필요한 곳). */
export function deckFolder(f: unknown, needIndex = true): string | null {
  if (!isFolderName(f)) return null;
  const dir = join(decksDir, f);
  try {
    if (!statSync(dir).isDirectory() || (needIndex && !existsSync(join(dir, "index.html")))) return null;
    const real = realpathSync(dir), base = realpathSync(decksDir);
    return real === base || real.startsWith(base + sep) ? dir : null;
  } catch { return null; }
}
