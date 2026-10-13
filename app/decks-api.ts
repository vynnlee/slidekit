import { join } from "node:path";
import { cp, mkdir, readdir, rename, rm, stat } from "node:fs/promises";

const root = join(import.meta.dir, "..");
const decks = join(root, "decks");
const NAME = /^[a-z0-9][a-z0-9-]*$/; // 새 이름 규칙
const SRC = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/; // 기존 폴더 이름(점으로 시작하는 폴더는 제외)
const err = (error: string, status: number) => Response.json({ error }, { status });
const exists = (p: string) => stat(p).then(() => true, () => false);

// 새 덱: engine/new.ts(slidekit new)를 그대로 실행해 규칙(이름 형식, 중복 거부)을 한 곳에 둔다.
export async function createDeck(req: Request) {
  const { name } = (await req.json().catch(() => ({}))) as { name?: unknown };
  if (typeof name !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return err("Use lowercase letters, digits and - only", 400);
  const p = Bun.spawn(["bun", join(root, "engine", "new.ts"), name], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if ((await p.exited) !== 0) return err("Name already exists", 409);
  return Response.json({ id: name }, { status: 201 });
}

// #deck-meta JSON을 고쳐 다시 쓴다. 메타가 없으면 그대로 둔다(id는 폴더 이름이 된다).
async function patchMeta(folder: string, fn: (m: Record<string, unknown>) => void) {
  const file = join(decks, folder, "index.html");
  const html = await Bun.file(file).text();
  const re = /(<script[^>]*id="deck-meta"[^>]*>)([\s\S]*?)(<\/script>)/;
  const m = html.match(re);
  if (!m) return;
  const meta = JSON.parse(m[2]);
  fn(meta);
  await Bun.write(file, html.replace(re, (_, a, _b, c) => `${a}\n    ${JSON.stringify(meta)}\n  ${c}`));
}

async function source(folder: string) {
  if (!SRC.test(folder) || !(await exists(join(decks, folder, "index.html")))) return null;
  return join(decks, folder);
}

export async function duplicateDeck(req: Request & { params: { folder: string } }) {
  const { folder } = req.params;
  const from = await source(folder);
  if (!from) return err("Deck not found", 404);
  let name = `${folder}-copy`;
  for (let i = 2; await exists(join(decks, name)); i++) name = `${folder}-copy-${i}`;
  await cp(from, join(decks, name), { recursive: true, filter: (p) => !p.startsWith(join(from, "history")) });
  await patchMeta(name, (m) => { if ("id" in m) m.id = name; if (typeof m.title === "string") m.title += " copy"; });
  return Response.json({ id: name, folder: name }, { status: 201 });
}

export async function renameDeck(req: Request & { params: { folder: string } }) {
  const { folder } = req.params;
  const { name } = (await req.json().catch(() => ({}))) as { name?: unknown };
  if (typeof name !== "string" || !NAME.test(name)) return err("Use lowercase letters, digits and - only", 400);
  const from = await source(folder);
  if (!from) return err("Deck not found", 404);
  if (name === folder) return Response.json({ id: name, folder: name });
  if (await exists(join(decks, name))) return err("Name already exists", 409);
  await rename(from, join(decks, name));
  await patchMeta(name, (m) => { if ("id" in m) m.id = name; });
  return Response.json({ id: name, folder: name });
}

// 영구 삭제는 하지 않는다. decks/.trash/<이름>-<타임스탬프>/로 옮긴다(점 폴더라 목록에서 빠진다).
export async function trashDeck(req: Request & { params: { folder: string } }) {
  const { folder } = req.params;
  const from = await source(folder);
  if (!from) return err("Deck not found", 404);
  const trash = join(decks, ".trash");
  await mkdir(trash, { recursive: true });
  await rename(from, join(trash, `${folder}-${new Date().toISOString().replace(/[:.]/g, "-")}`));
  return Response.json({ ok: true });
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
    return { entry, ...p, title };
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
  "/api/trash": { GET: listTrash },
  "/api/trash/:entry/restore": { POST: restoreDeck },
  "/api/trash/:entry/purge": { POST: purgeDeck },
};
