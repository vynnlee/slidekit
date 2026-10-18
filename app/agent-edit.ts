// POST /api/decks/<덱>/edit: 채널의 slidekit_edit 도구가 부른다(spec/AGENT-PRESENCE.md).
// 덱의 index.html 하나만, old_str가 정확히 1번일 때만, 전부 성공하거나 전부 취소로 고친다.
import { join } from "node:path";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { lint } from "../engine/lint";
import { readOnlyDeck, withDeckLock } from "./deck-lock";
import { deckFolder } from "./folder";
import { noteFileChanged } from "./versions";
import { presence } from "./comments";
import { MAX_EDITS, MAX_STR, applyEdits, changedSlides, revisionOf, type Edit } from "./slide-edit";

const bad = (error: string, message: string, status = 400) => Response.json({ ok: false, error, message }, { status });

export const routes = {
  "/api/decks/:folder/edit": {
    POST: async (req: Request & { params: { folder: string } }) => {
      const dir = deckFolder(req.params.folder);
      if (!dir) return bad("deck", "덱 폴더가 아니다", 404);
      const deck = req.params.folder;
      if (readOnlyDeck(deck)) return bad("read_only", "읽기 전용 덱이다", 403);
      const b = (await req.json().catch(() => null)) as { edits?: unknown; base_revision?: unknown; agent?: unknown } | null;
      if (!b || !Array.isArray(b.edits) || b.edits.length < 1 || b.edits.length > MAX_EDITS) return bad("edits", `edits는 1~${MAX_EDITS}개 배열이다`);
      const edits: Edit[] = [];
      for (const e of b.edits as Record<string, unknown>[]) {
        if (!e || typeof e.old_str !== "string" || typeof e.new_str !== "string" || !e.old_str || e.old_str.length > MAX_STR || e.new_str.length > MAX_STR) return bad("edits", `edit마다 old_str(1~${MAX_STR}자)와 new_str(${MAX_STR}자 이하) 문자열이 필요하다`);
        edits.push({ old_str: e.old_str, new_str: e.new_str });
      }
      if (b.base_revision !== undefined && !(typeof b.base_revision === "string" && /^[0-9a-f]{16}$/.test(b.base_revision))) return bad("base_revision", "base_revision은 16자리 소문자 hex다");
      const agent = typeof b.agent === "string" && /^[\w.-]{1,32}$/.test(b.agent) ? b.agent : "claude";
      const id = `e-${crypto.randomUUID().slice(0, 8)}`;
      const file = join(dir, "index.html");
      return withDeckLock(deck, async () => {
        const src = readFileSync(file, "utf8"), revision = revisionOf(src);
        const fail = (error: string, message: string, extra: Record<string, unknown> = {}) => {
          presence("agent.edit.fail", { id, deck, agent, reason: error });
          return Response.json({ ok: false, error, message, revision, ...extra }, { status: 409 });
        };
        if (b.base_revision && b.base_revision !== revision) return fail("revision_mismatch", "덱이 읽은 뒤에 바뀌었다. 다시 읽고 고르라");
        const r = applyEdits(src, edits);
        if (!r.ok) return fail(r.error, r.message, { index: r.index, ...(r.hints ? { hints: r.hints } : {}) });
        presence("agent.edit.start", { id, deck, agent, kind: "edit", slide: r.slides[0], anchor: { path: "", excerpt: r.excerpt } });
        const tmp = `${file}.tmp-${crypto.randomUUID()}`;
        writeFileSync(tmp, r.out);
        renameSync(tmp, file);
        // 직전 내용을 external 스냅샷으로 남기고 수정 기록도 쓴다(코멘트 reply의 Revert와 Version history가 이 수정을 되돌릴 수 있다). watcher는 lastSeen이 맞아 이벤트를 또 만들지 않는다.
        try { noteFileChanged(deck); } catch (e) { console.error(`[slidekit] ${deck}: 버전 기록 실패: ${(e as Error).message}`); }
        const next = revisionOf(r.out), changed = changedSlides(src, r.out);
        presence("agent.edit.done", { id, deck, agent, via: "tool", changed, revision: next });
        return Response.json({ ok: true, revision: next, changed, lint: lint(r.out).slice(0, 30) });
      });
    },
  },
};
