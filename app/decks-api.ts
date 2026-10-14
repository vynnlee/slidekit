import { join, relative, sep } from "node:path";
import { deckFolder, decksDir } from "./folder";
import { TEMPLATES, TEMPLATE_IDS } from "../engine/templates";
import { readMeta, safeJson, setMeta } from "./src/lib/deck-meta";
import { AssetError, MAX_BYTES, saveAsset } from "../engine/assets";
import { readOnlyDeck, withDeckLock } from "./deck-lock";
import { readPublish } from "../engine/publish-record";
import { cp, mkdir, readdir, rename, rm, stat } from "node:fs/promises";

const root = join(import.meta.dir, "..");
const decks = decksDir; // 테스트는 SLIDEKIT_DECKS로 임시 폴더를 쓴다
const NAME = /^[a-z0-9][a-z0-9-]*$/; // 새 이름 규칙
const SRC = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/; // 기존 폴더 이름(점으로 시작하는 폴더는 제외)
const err = (error: string, status: number) => Response.json({ error }, { status });
const RO = () => err("This deck is read-only on this server", 403);
const exists = (p: string) => stat(p).then(() => true, () => false);

// 같은 폴더의 임시 파일에 쓴 뒤 rename한다(중간 상태가 남지 않는다).
async function writeAtomic(file: string, text: string) {
  const tmp = `${file}.tmp-${crypto.randomUUID()}`;
  await Bun.write(tmp, text);
  await rename(tmp, file);
}

// 새 덱: engine/new.ts(slidekit new)를 그대로 실행해 규칙(이름 형식, 중복 거부)을 한 곳에 둔다.
export async function createDeck(req: Request) {
  const { name, title, template } = (await req.json().catch(() => ({}))) as { name?: unknown; title?: unknown; template?: unknown };
  if (template !== undefined && (typeof template !== "string" || !TEMPLATE_IDS.includes(template))) return err("Unknown template", 400);
  if (typeof name !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return err("Use lowercase letters, digits and - only", 400);
  const t = cleanTitle(title);
  if (title !== undefined && t === null) return err("Title must be 1 to 120 characters on one line", 400);
  if (await exists(join(decks, name))) return err(`A deck named ${name} already exists`, 409);
  const p = Bun.spawn(["bun", join(root, "engine", "new.ts"), name, ...(template ? ["--template", template] : [])], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if ((await p.exited) !== 0) return err("Could not create the deck", 500);
  if (t) await setTitle(name, t);
  return Response.json({ id: name }, { status: 201 });
}

const cleanTitle = (v: unknown) => (typeof v === "string" && /^[^\r\n]{1,120}$/.test(v.trim()) ? v.trim() : null);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// 제목은 deck-meta.title과 <title>, 표지의 첫 <h1>에 들어간다(새 덱 템플릿은 셋 다 같은 값으로 시작한다).
async function setTitle(folder: string, title: string) {
  const file = join(decks, folder, "index.html");
  let html = await Bun.file(file).text();
  const old = html.match(/<title>([^<]*)<\/title>/)?.[1];
  html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${esc(title)}</title>`);
  // 표지 h1이 옛 제목과 같을 때만 바꾼다(손으로 고친 표지는 건드리지 않는다).
  if (old !== undefined) html = html.replace(new RegExp(`(<h1[^>]*>)${old.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(</h1>)`), (_, a, b) => `${a}${esc(title)}${b}`);
  await writeAtomic(file, withMeta(html, (m) => { m.title = title; }));
}

export async function retitleDeck(req: Request & { params: { folder: string } }) {
  const { folder } = req.params;
  const { title } = (await req.json().catch(() => ({}))) as { title?: unknown };
  const t = cleanTitle(title);
  if (!t) return err("Title must be 1 to 120 characters on one line", 400);
  if (!(await source(folder))) return err("Deck not found", 404);
  if (readOnlyDeck(folder)) return RO();
  await withDeckLock(folder, () => setTitle(folder, t));
  return Response.json({ title: t });
}

// #deck-meta JSON을 고쳐 다시 쓴다. 메타가 없으면 그대로 둔다(id는 폴더 이름이 된다).
// safeJson은 src/lib/deck-meta.ts에 있다(편집기와 같은 구현). 다른 모듈이 여기서 가져다 쓰므로 다시 내보낸다.
export { safeJson };

// 문서의 #deck-meta를 고친 새 문서를 돌려준다. 메타가 없거나 JSON이 깨졌으면 그대로 둔다.
export function withMeta(html: string, fn: (m: Record<string, unknown>) => void): string {
  const re = /(<script[^>]*id="deck-meta"[^>]*>)([\s\S]*?)(<\/script>)/;
  const m = html.match(re);
  if (!m) return html;
  let meta: Record<string, unknown>;
  try { meta = JSON.parse(m[2]); } catch { return html; }
  fn(meta);
  return html.replace(re, (_, a, _b, c) => `${a}\n    ${safeJson(meta)}\n  ${c}`);
}

// 이미지 업로드: 본문은 이미지 바이트 그대로. 파일명은 x-filename 헤더(퍼센트 인코딩) 또는 ?name=, 선택 ?max=(긴 변 최대 픽셀).
export async function uploadAsset(req: Request & { params: { folder: string } }) {
  const dir = deckFolder(req.params.folder);
  if (!dir) return err("Deck not found", 404);
  if (readOnlyDeck(req.params.folder)) return RO();
  const len = Number(req.headers.get("content-length") ?? NaN);
  if (!Number.isFinite(len)) return err("Content-Length is required", 411);
  if (len > MAX_BYTES) return err("The image is larger than 20 MB", 413);
  const u = new URL(req.url);
  let name = u.searchParams.get("name") ?? req.headers.get("x-filename") ?? "";
  try { name = decodeURIComponent(name); } catch { /* 퍼센트 인코딩이 아니면 그대로 */ }
  const max = u.searchParams.has("max") ? Number(u.searchParams.get("max")) : undefined;
  if (max !== undefined && !(Number.isInteger(max) && max >= 200 && max <= 8000)) return err("max must be 200 to 8000", 400);
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length > MAX_BYTES) return err("The image is larger than 20 MB", 413);
  try { return Response.json(saveAsset(dir, name, bytes, max ? { max } : {}), { status: 201 }); }
  catch (e) {
    if (e instanceof AssetError) return Response.json({ error: "This image cannot be added. Use a PNG, JPEG, GIF, WebP or SVG file.", detail: e.message }, { status: 400 });
    return err("Could not save the image", 500);
  }
}

// 덱 설정: 읽을 때 받은 mtime(base)과 같을 때만 쓴다. 편집기 자동 저장이나 밖의 수정이 먼저 일어났으면 409로 거절한다.
export async function getMeta(req: Request & { params: { folder: string } }) {
  if (!(await source(req.params.folder))) return err("Deck not found", 404);
  const file = join(decks, req.params.folder, "index.html");
  const meta = readMeta(await Bun.file(file).text());
  if (!meta) return err("This deck has no readable deck-meta block.", 422);
  return Response.json({ meta, mtime: (await stat(file)).mtimeMs });
}
export async function patchDeckMeta(req: Request & { params: { folder: string } }) {
  const { folder } = req.params;
  const b = (await req.json().catch(() => null)) as { patch?: unknown; base?: unknown } | null;
  if (!b || typeof b.base !== "number") return err("Missing base", 400);
  if (!(await source(folder))) return err("Deck not found", 404);
  if (readOnlyDeck(folder)) return RO();
  const file = join(decks, folder, "index.html");
  // 읽기, 비교, 쓰기를 덱 잠금 안에서 한 번에 한다(편집기 저장과 겹쳐 서로 지우지 않게).
  return withDeckLock(folder, async () => {
    if ((await stat(file)).mtimeMs !== b.base) return err("changed", 409);
    const r = setMeta(await Bun.file(file).text(), b.patch);
    if (!r.ok) return Response.json({ error: r.issues[0].msg, issues: r.issues }, { status: 400 });
    await writeAtomic(file, r.html);
    return Response.json({ meta: r.meta, mtime: (await stat(file)).mtimeMs });
  });
}

function patchMeta(folder: string, fn: (m: Record<string, unknown>) => void) {
  const file = join(decks, folder, "index.html");
  return withDeckLock(folder, async () => {
    const html = await Bun.file(file).text();
    const next = withMeta(html, fn);
    if (next !== html) await writeAtomic(file, next);
  });
}

// 덱 폴더 검증은 folder.ts 한 곳의 규칙을 쓴다(형식, 디렉터리, index.html, 심볼릭 링크로 밖을 가리키지 않기).
async function source(folder: string) {
  return deckFolder(folder);
}

export async function duplicateDeck(req: Request & { params: { folder: string } }) {
  const { folder } = req.params;
  const from = await source(folder);
  if (!from) return err("Deck not found", 404);
  let name = `${folder}-copy`;
  for (let i = 2; await exists(join(decks, name)); i++) name = `${folder}-copy-${i}`;
  // 복제하지 않는 것: history/, comments.json(코멘트는 복제하지 않는다), 그리고 점으로 시작하는 이름 전체(.versions, .publish.json 같은 이 기기의 상태 파일).
  // history-notes.md 같은 형제 이름은 남긴다. 덱 루트의 첫 경로 조각으로만 판단한다.
  const skip = (p: string) => { const top = relative(from, p).split(sep)[0]; return top === "history" || top === "comments.json" || top.startsWith("."); };
  await cp(from, join(decks, name), { recursive: true, filter: (p) => !skip(p) });
  await patchMeta(name, (m) => { if ("id" in m) m.id = name; if (typeof m.title === "string") m.title += " copy"; });
  return Response.json({ id: name, folder: name }, { status: 201 });
}

export async function renameDeck(req: Request & { params: { folder: string } }) {
  const { folder } = req.params;
  const { name } = (await req.json().catch(() => ({}))) as { name?: unknown };
  if (typeof name !== "string" || !NAME.test(name)) return err("Use lowercase letters, digits and - only", 400);
  const from = await source(folder);
  if (!from) return err("Deck not found", 404);
  if (readOnlyDeck(folder)) return RO();
  if (name === folder) return Response.json({ id: name, folder: name });
  // 대상 폴더를 먼저 만들어 선점한다(rename은 빈 폴더 위로 옮겨 쓴다).
  if (!(await mkdir(join(decks, name)).then(() => true, () => false))) return err("Name already exists", 409);
  await withDeckLock(folder, () => rename(from, join(decks, name)));
  await patchMeta(name, (m) => { if ("id" in m) m.id = name; });
  return Response.json({ id: name, folder: name });
}

// 영구 삭제는 하지 않는다. decks/.trash/<이름>-<타임스탬프>/로 옮긴다(점 폴더라 목록에서 빠진다).
export async function trashDeck(req: Request & { params: { folder: string } }) {
  const { folder } = req.params;
  const from = await source(folder);
  if (!from) return err("Deck not found", 404);
  if (readOnlyDeck(folder)) return RO();
  const trash = join(decks, ".trash");
  await mkdir(trash, { recursive: true });
  const entry = `${folder}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const published = readPublish(from).current?.url ?? null; // 휴지통으로 옮겨도 게시본은 계속 열려 있다: 화면이 알릴 수 있게 주소를 돌려준다
  await withDeckLock(folder, () => rename(from, join(trash, entry)));
  return Response.json({ ok: true, entry, published });
}

// ---- 휴지통(decks/.trash/<이름>-<타임스탬프>) ----
const trashDir = join(decks, ".trash");
const ENTRY = /^(.+)-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/;

function parseEntry(entry: string) {
  const m = SRC.test(entry) ? entry.match(ENTRY) : null;
  return m ? { folder: m[1], deletedAt: `${m[2]}T${m[3]}:${m[4]}:${m[5]}.${m[6]}Z` } : null;
}

export async function listTrash() {
  const names = await readdir(trashDir).catch(() => [] as string[]);
  const items = await Promise.all(names.map(async (entry) => {
    const p = parseEntry(entry);
    if (!p) return null;
    const html = await Bun.file(join(trashDir, entry, "index.html")).text().catch(() => "");
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? p.folder;
    return { entry, ...p, title, published: readPublish(join(trashDir, entry)).current?.url ?? null };
  }));
  return Response.json(items.filter(Boolean).sort((a, b) => b!.deletedAt.localeCompare(a!.deletedAt)));
}

type EntryReq = Request & { params: { entry: string } };

export async function restoreDeck(req: EntryReq) {
  const p = parseEntry(req.params.entry);
  const from = join(trashDir, req.params.entry);
  if (!p || !(await exists(from))) return err("Not in trash", 404);
  let name = p.folder;
  if (await exists(join(decks, name))) {
    name = `${p.folder}-restored`;
    for (let i = 2; await exists(join(decks, name)); i++) name = `${p.folder}-restored-${i}`;
  }
  await rename(from, join(decks, name));
  if (name !== p.folder) await patchMeta(name, (m) => { if ("id" in m) m.id = name; });
  return Response.json({ folder: name });
}

// 영구 삭제는 이 경로에서만 한다. 원래 폴더 이름을 body.confirm으로 받아야 지운다.
export async function purgeDeck(req: EntryReq) {
  const p = parseEntry(req.params.entry);
  const from = join(trashDir, req.params.entry);
  if (!p || !(await exists(from))) return err("Not in trash", 404);
  const { confirm } = (await req.json().catch(() => ({}))) as { confirm?: unknown };
  if (confirm !== p.folder) return err("Type the deck name to confirm", 400);
  await rm(from, { recursive: true });
  return Response.json({ ok: true });
}

// 연결 상태 표시가 쓰는 가벼운 응답
export const routes = {
  "/api/ping": () => new Response("ok"),
  "/api/decks/:folder/duplicate": { POST: duplicateDeck },
  "/api/decks/:folder/rename": { POST: renameDeck },
  // "/api/decks/:folder"는 편집기의 저장(PUT)이 쓰므로 휴지통은 별도 경로로 둔다.
  "/api/decks/:folder/trash": { POST: trashDeck },
  "/api/decks/:folder/title": { POST: retitleDeck },
  "/api/decks/:folder/meta": { GET: getMeta, PATCH: patchDeckMeta },
  "/api/decks/:folder/assets": { POST: uploadAsset },
  "/api/trash": { GET: listTrash },
  // 새 덱 템플릿 목록(id, label). 엔진 모듈은 node:fs를 써서 브라우저 번들에 넣을 수 없으므로 API로 받는다.
  "/api/templates": { GET: () => Response.json(TEMPLATES.map(({ id, label }) => ({ id, label }))) },
  "/api/trash/:entry/restore": { POST: restoreDeck },
  "/api/trash/:entry/purge": { POST: purgeDeck },
};
