import { join } from "node:path";
import { remap } from "./comments";
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";

const decksDir = join(import.meta.dir, "..", "decks");
const folderOk = (f: string) => /^[\w.-]+$/.test(f) && f !== "." && f !== ".." && existsSync(join(decksDir, f, "index.html"));
const bad = (error: string, status = 400) => Response.json({ error }, { status });

// 덱 원문을 그대로 읽고 쓴다. 쪼개고 합치는 일은 편집기가 한다(SPEC 9절).
// 저장은 임시 파일에 쓴 뒤 rename한다. 읽은 시점 이후 파일이 바뀌었으면 409를 돌려준다.
export const routes = {
  "/api/decks/:folder/source": {
    GET: (req: Request & { params: { folder: string } }) => {
      const { folder } = req.params;
      if (!folderOk(folder)) return bad("deck", 404);
      const file = join(decksDir, folder, "index.html");
      return Response.json({ source: readFileSync(file, "utf8"), mtime: statSync(file).mtimeMs });
    },
  },
  "/api/decks/:folder": {
    PUT: async (req: Request & { params: { folder: string } }) => {
      const { folder } = req.params;
      if (!folderOk(folder)) return bad("deck", 404);
      const b = (await req.json().catch(() => null)) as { source?: unknown; base?: unknown; force?: unknown; slideMap?: unknown } | null;
      if (!b || typeof b.source !== "string") return bad("source");
      if (!/data-slidekit=/.test(b.source) || !/<section\b[^>]*\bdata-slide\b/.test(b.source)) return bad("not a slidekit deck");
      const file = join(decksDir, folder, "index.html");
      if (!b.force && typeof b.base === "number" && statSync(file).mtimeMs !== b.base) return bad("changed", 409);
      const tmp = `${file}.tmp-${process.pid}`;
      writeFileSync(tmp, b.source);
      renameSync(tmp, file);
      // 순서 변경과 삭제를 코멘트의 슬라이드 번호에 반영한다(옛 번호 -> 새 번호)
      if (b.slideMap && typeof b.slideMap === "object") remap(folder, b.slideMap as Record<string, number>);
      return Response.json({ mtime: statSync(file).mtimeMs });
    },
  },
};
