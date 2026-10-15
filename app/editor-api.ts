import { join } from "node:path";
import { readOnlyDeck, withDeckLock } from "./deck-lock";
import { remap } from "./comments";
import { afterSave } from "./versions";
import { deckFolder } from "./folder";
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";

const decksDir = join(import.meta.dir, "..", "decks");
const folderOk = (f: string) => deckFolder(f) !== null; // 규칙은 app/folder.ts 한 곳
const bad = (error: string, status = 400) => Response.json({ error }, { status });

// 덱 원문을 그대로 읽고 쓴다. 쪼개고 합치는 일은 편집기가 한다(SPEC 9절).
// 저장은 임시 파일에 쓴 뒤 rename한다. 읽은 시점 이후 파일이 바뀌었으면 409를 돌려준다.
export const routes = {
  "/api/decks/:folder/source": {
    GET: (req: Request & { params: { folder: string } }) => {
      const { folder } = req.params;
      if (!folderOk(folder)) return bad("deck", 404);
      const file = join(decksDir, folder, "index.html");
      // 앱의 쓰기와는 잠금으로, 앱 밖의 쓰기(Claude, 다른 편집기)와는 읽기 전후의 mtime 비교로 맞춘다.
      // 사이에 파일이 바뀌면 옛 내용에 새 mtime이 붙어 이후 저장이 409 없이 외부 변경을 덮어쓰므로 다시 읽는다.
      return withDeckLock(folder, async () => {
        for (let i = 0; ; i++) {
          const before = statSync(file).mtimeMs, source = readFileSync(file, "utf8"), after = statSync(file).mtimeMs;
          if (before === after || i >= 4) return Response.json({ source, mtime: before }); // 끝까지 안 맞으면 읽기 전 mtime(더 낡은 쪽)을 줘서 다음 저장이 409로 걸리게 한다
        }
      });
    },
  },
  "/api/decks/:folder": {
    PUT: async (req: Request & { params: { folder: string } }) => {
      const { folder } = req.params;
      if (!folderOk(folder)) return bad("deck", 404);
      // 테스트 서버 전용 가드(SLIDEKIT_READONLY_DECKS, 사용자가 쓰는 서버에는 설정하지 않는다)
      if (readOnlyDeck(folder)) return bad("read-only deck", 403);
      const b = (await req.json().catch(() => null)) as { source?: unknown; base?: unknown; force?: unknown; slideMap?: unknown } | null;
      if (!b || typeof b.source !== "string") return bad("source");
      if (!/data-slidekit=/.test(b.source) || !/<section\b[^>]*\bdata-slide\b/.test(b.source)) return bad("not a slidekit deck");
      if (typeof b.base !== "number") return bad("base");
      const file = join(decksDir, folder, "index.html"), source = b.source, force = b.force, base = b.base, slideMap = b.slideMap;
      // 설정, 제목 변경 같은 다른 쓰기와 겹치지 않게 덱 단위로 차례로 실행한다(mtime 비교부터 rename까지)
      return withDeckLock(folder, async () => {
        if (!force && statSync(file).mtimeMs !== base) return bad("changed", 409);
        const tmp = `${file}.tmp-${crypto.randomUUID()}`;
        const prev = readFileSync(file, "utf8"); // 버전 기록: 덮어쓰기 전 내용
        writeFileSync(tmp, source);
        renameSync(tmp, file);
        // 파일은 이미 저장됐다. 버전 기록이나 코멘트 번호 갱신이 실패해도(디스크, 손상된 comments.json) 저장 실패로 답하면
        // 편집기가 오래된 base로 다시 시도해 409와 Overwrite 안내를 띄우므로, 실패는 기록만 하고 성공으로 답한다.
        try { afterSave(folder, prev, source); } catch (e) { console.error(`[slidekit] ${folder}: 버전 기록 실패: ${(e as Error).message}`); }
        // 순서 변경과 삭제를 코멘트의 슬라이드 번호에 반영한다(옛 번호 -> 새 번호)
        if (slideMap && typeof slideMap === "object") {
          try { remap(folder, slideMap as Record<string, number>); } catch (e) { console.error(`[slidekit] ${folder}: 코멘트 번호 갱신 실패: ${(e as Error).message}`); }
        }
        return Response.json({ mtime: statSync(file).mtimeMs });
      });
    },
  },
};
