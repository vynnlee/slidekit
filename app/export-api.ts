// 편집기의 Export 메뉴용 API: 번들, PDF, 다운로드, 배포. 내부는 slidekit bundle, pdf, deploy 스크립트를 자식 프로세스로 돌린다.
// 한 번에 하나만 돌린다(409). 배포는 NDJSON 스트림으로 진행 로그를 흘린다: {"log":"..."} 줄들 뒤에 {"done":true,"url":...} 또는 {"error":...}.
// 비밀번호는 자식 프로세스 환경 변수로만 넘기고, 로그와 응답에서는 지운다.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { deckFingerprint, readPublish, recordUnpublish } from "../engine/publish-record";
import { deckCheck } from "../engine/deck-check";
import { outline } from "../engine/outline";
import { readOnlyDeck } from "./deck-lock";

const root = join(import.meta.dir, "..");
const ID = /^[a-z0-9][a-z0-9-]*$/;
// 사람이 읽는 영어 문장. code는 그대로 남겨 클라이언트와 테스트가 구분한다. 엔진의 한국어 출력 같은 자세한 내용은 details로 따로 준다.
const WORDS: Record<string, string> = {
  deck: "This deck was not found, or its folder name cannot be exported (use lowercase letters, numbers and hyphens).",
  busy: "Another export is already running. Wait for it to finish or cancel it.",
  confirm: "Confirm the publish first.",
  password: "Enter a password of at least 8 characters.",
  "deck-meta": "The deck's deck-meta block could not be read, so its visibility is unknown. Fix it before publishing.",
  kind: "Choose html, pdf, notes-pdf or handout-pdf.",
  "pdf-options": "Choose slides, notes or handout. A handout puts 2, 3, 4 or 6 slides on a page.",
  "not built": "Nothing to download yet. Build the file first.",
  "bundle-failed": "The HTML bundle could not be built. Run lint on the deck or see Details.",
  "pdf-failed": "The PDF could not be made. See Details.",
  canceled: "Canceled.",
  "not-published": "This deck has no publish record, so there is nothing to unpublish.",
  "read-only": "This deck is read-only here.",
  "confirm-name": "The published name differs from this deck folder. Type the published name to confirm.",
};
const bad = (code: string, status = 400, details?: string) => Response.json({ error: WORDS[code] ?? code, code, ...(details ? { details } : {}) }, { status });

// 게시 실패의 흔한 원인을 출력에서 찾아 한 줄로 알려 준다.
const why = (lines: string[]) => {
  const t = lines.join("\n");
  if (/slidekit-cloudflare-token|CLOUDFLARE_API_TOKEN|토큰/i.test(t)) return "No Cloudflare token was found. Save it in the Keychain as slidekit-cloudflare-token.";
  if (/ENOTFOUND|ECONN|fetch failed|network|네트워크/i.test(t)) return "Could not reach Cloudflare. Check the network connection.";
  if (/deck-meta/i.test(t)) return "The deck-meta block could not be read. Fix it in the deck's index.html.";
  return "";
};

type Run = (script: string, id: string, env?: Record<string, string>, onLine?: (l: string) => void, args?: string[]) => Promise<{ code: number; lines: string[] }>;

// 실제 실행: bun <script> <id>. stdout과 stderr 줄을 모은다.
let active: ReturnType<typeof Bun.spawn> | null = null;
let canceled = false;
/** 돌고 있는 번들, PDF, 게시를 멈춘다. 돌고 있는 것이 있으면 true. */
export function cancelExport(): boolean {
  if (!active) return false;
  canceled = true;
  active.kill();
  return true;
}
const spawnRun: Run = async (script, id, env = {}, onLine, args = []) => {
  const p = Bun.spawn(["bun", join(root, script), id, ...args], { cwd: root, env: { ...process.env, ...env }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  active = p;
  const kill = setTimeout(() => p.kill(), 5 * 60_000);
  const lines: string[] = [];
  const pump = async (s: ReadableStream<Uint8Array>) => {
    let buf = "";
    const dec = new TextDecoder();
    for await (const c of s) {
      buf += dec.decode(c, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i).replace(/\r$/, ""); buf = buf.slice(i + 1); if (l.trim()) { lines.push(l); onLine?.(l); } }
    }
    if (buf.trim()) { lines.push(buf); onLine?.(buf); }
  };
  await Promise.all([pump(p.stdout), pump(p.stderr)]);
  const code = await p.exited;
  clearTimeout(kill);
  active = null;
  return { code, lines };
};

const dist = (id: string, ext: string) => join(root, "dist", `${id}.${ext}`);
const meta = (id: string) => {
  // 공개 범위는 항상 덱 원본의 deck-meta로 판단한다(오래된 dist가 public이라고 말해도 따르지 않는다).
  const html = readFileSync(join(root, "decks", id, "index.html"), "utf8");
  try { return JSON.parse(html.match(/<script[^>]*id="deck-meta"[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? ""); } catch { return null; } // 읽지 못하면 공개로 가정하지 않는다
};

export function makeRoutes(run: Run = spawnRun) {
  let busy = false;
  type Req = Request & { params: { id: string } };
  const deckId = (req: Req) => {
    const id = req.params.id;
    return ID.test(id) && existsSync(join(root, "decks", id, "index.html")) ? id : null;
  };
  // 짧은 작업(번들, PDF)은 끝나면 JSON으로 답한다.
  const quick = (script: string, ext: "html" | "pdf") => async (req: Req) => {
    const id = deckId(req);
    if (!id) return bad("deck", 404);
    if (busy) return bad("busy", 409);
    busy = true; canceled = false;
    try {
      const r = await run(script, id);
      if (canceled) return bad("canceled", 499);
      if (r.code !== 0 || !existsSync(dist(id, ext))) return bad(ext === "pdf" ? "pdf-failed" : "bundle-failed", 500, r.lines.slice(-3).join("\n"));
      const pages = ext === "pdf" ? +(r.lines.join("\n").match(/(\d+)페이지/)?.[1] ?? 0) : undefined;
      return Response.json({ path: `dist/${id}.${ext}`, bytes: statSync(dist(id, ext)).size, pages });
    } finally { busy = false; }
  };
  // PDF는 선택 옵션을 받는다: 본문 {"mode": "slides" | "notes" | "handout", "per": 2 | 3 | 4 | 6}(per는 handout만, 기본 3). 없으면 슬라이드 PDF.
  // 파일: dist/<id>.pdf, <id>.notes.pdf(쪽마다 슬라이드 한 장과 노트), <id>.handout.pdf(쪽마다 여러 장).
  const pdf = async (req: Req) => {
    const id = deckId(req);
    if (!id) return bad("deck", 404);
    const b = (await req.json().catch(() => ({}))) as { mode?: unknown; per?: unknown } | null;
    const mode = b?.mode ?? "slides", per = b?.per ?? 3;
    if (mode !== "slides" && mode !== "notes" && mode !== "handout") return bad("pdf-options");
    if (mode === "handout" && ![2, 3, 4, 6].includes(per as number)) return bad("pdf-options");
    const ext = mode === "slides" ? "pdf" : `${mode}.pdf`;
    const args = mode === "notes" ? ["--notes"] : mode === "handout" ? ["--handout", String(per)] : [];
    if (busy) return bad("busy", 409);
    busy = true; canceled = false;
    try {
      const r = await run("engine/pdf.ts", id, {}, undefined, args);
      if (canceled) return bad("canceled", 499);
      if (r.code !== 0 || !existsSync(dist(id, ext))) return bad("pdf-failed", 500, r.lines.slice(-3).join("\n"));
      const pages = +(r.lines.join("\n").match(/(\d+)페이지/)?.[1] ?? 0);
      return Response.json({ path: `dist/${id}.${ext}`, bytes: statSync(dist(id, ext)).size, pages });
    } finally { busy = false; }
  };
  // 배포 전 점검: lint 결과, 큰 이미지, 공개 범위, 번들 크기 추정. 읽기만 하고 아무것도 만들지 않는다.
  const check = (req: Req) => {
    const id = deckId(req);
    if (!id) return bad("deck", 404);
    const dir = join(root, "decks", id);
    const c = deckCheck(dir, id);
    return Response.json({
      errors: c.lint.errors,
      warnings: c.lint.warnings,
      issues: c.lint.issues.slice(0, 5).map((i) => ({ level: i.level, rule: i.rule, msg: i.msg.slice(0, 200) })),
      largeImages: [...c.largeImages].sort((a, b) => b.size - a.size).slice(0, 3).map((r) => ({ file: r.rel, bytes: r.size })),
      visibility: c.visibility,
      estimatedBytes: c.size.estimatedBytes, // 글꼴 서브셋은 번들 때 더해진다
      lastBundleBytes: c.size.lastBundleBytes, // 덱보다 새로 만든 번들이 있을 때만
      notesMissing: c.notes.missing.length,
      slides: c.slides,
      lowContrast: c.contrast.filter((r) => r.level === "fail" && r.ratio !== null).slice(0, 2).map((r) => ({ name: r.name, ratio: r.ratio, need: r.need })),
    });
  };
  return {
    "/api/decks/:id/check": { GET: check },
    // 게시 기록(.publish.json)과 현재 덱의 달라짐. 기록이 없으면 published false.
    "/api/decks/:id/published": {
      GET: (req: Req) => {
        const id = deckId(req);
        if (!id) return bad("deck", 404);
        const dir = join(root, "decks", id);
        const { current, history } = readPublish(dir);
        if (!current) return Response.json({ published: false });
        return Response.json({ published: true, ...current, changed: deckFingerprint(dir) !== current.sha, history: history.slice(0, 20) });
      },
    },
    // 게시 취소: 확인(confirm)이 있어야 하고 CLI를 --yes로 부른다. 실제 삭제는 이 요청에서만 일어난다. 기록의 name으로 지워서 폴더 이름이 바뀌었어도 옛 주소를 취소할 수 있다.
    "/api/decks/:id/unpublish": {
      POST: async (req: Req) => {
        const id = deckId(req);
        if (!id) return bad("deck", 404);
        const b = (await req.json().catch(() => null)) as { confirm?: unknown; confirmName?: unknown } | null;
        if (!b || b.confirm !== true) return bad("confirm");
        if (readOnlyDeck(id)) return bad("read-only", 403);
        const dir = join(root, "decks", id);
        const cur = readPublish(dir).current;
        if (!cur) return bad("not-published", 409);
        // 기록의 name이 폴더와 다르면(이름 바꾸기 뒤이거나, 공유받은 덱의 위조 기록) 사용자가 그 이름을 직접 입력해야 지운다.
        if (cur.name !== id && b.confirmName !== cur.name) return bad("confirm-name", 400);
        if (busy) return bad("busy", 409);
        busy = true; canceled = false;
        const enc = new TextEncoder();
        const stream = new ReadableStream({
          async start(c) {
            const send = (o: unknown) => c.enqueue(enc.encode(JSON.stringify(o) + "\n"));
            try {
              const env: Record<string, string> = {};
              if (process.env.SLIDEKIT_DEPLOY_DRY_RUN) env.SLIDEKIT_DEPLOY_DRY_RUN = "1";
              send({ log: "Removing from Cloudflare..." });
              const r = await run("deploy/unpublish.ts", cur.name, env, (l) => send({ log: l }), ["--yes"]);
              const text = r.lines.join("\n");
              if (canceled) send({ error: WORDS.canceled, code: "canceled" });
              else if (r.code === 0 && /^Dry run:/m.test(text)) send({ done: true, dryRun: true }); // 아무것도 지우지 않았으니 기록도 그대로 둔다
              else if (r.code === 0 && /^Unpublished /m.test(text)) { try { recordUnpublish(dir); } catch { /* 기록 실패는 취소 결과에 영향 없음 */ } send({ done: true, dryRun: false }); }
              else if (r.code === 3) { try { recordUnpublish(dir); } catch { /* */ } send({ error: "Nothing is published under that name anymore. The record was out of date and is cleared.", details: r.lines.slice(-3).join("\n") }); }
              else send({ error: `Could not unpublish. ${why(r.lines) || "See Details."}`, details: r.lines.slice(-3).join("\n") });
            } catch (e) { send({ error: String(e) }); }
            finally { busy = false; c.close(); }
          },
        });
        return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
      },
    },
    "/api/export/cancel": { POST: () => Response.json({ ok: true, canceled: cancelExport() }) },
    "/api/decks/:id/bundle": { POST: quick("bundler/bundle.ts", "html") },
    "/api/decks/:id/pdf": { POST: pdf },
    "/api/decks/:id/download": {
      GET: (req: Req) => {
        const id = deckId(req);
        if (!id) return bad("deck", 404);
        const kind = new URL(req.url).searchParams.get("kind");
        const EXT: Record<string, string> = { html: "html", pdf: "pdf", "notes-pdf": "notes.pdf", "handout-pdf": "handout.pdf" };
        const ext = kind ? EXT[kind] : undefined;
        if (!ext) return bad("kind");
        const f = Bun.file(dist(id, ext));
        if (!existsSync(dist(id, ext))) return bad("not built", 404);
        return new Response(f, { headers: {
          "Content-Type": ext.endsWith("pdf") ? "application/pdf" : "text/html; charset=utf-8",
          "Content-Disposition": `attachment; filename="${id}.${ext}"`, "Cache-Control": "no-store",
        } });
      },
    },
    // 덱 내용을 Markdown으로(복사와 .md 내려받기). 덱 index.html만 읽고 코멘트, 게시 기록, 비밀번호는 담지 않는다.
    "/api/decks/:id/outline": {
      GET: async (req: Req) => {
        const id = deckId(req);
        if (!id) return bad("deck", 404);
        const q = new URL(req.url).searchParams;
        const md = outline(await Bun.file(join(root, "decks", id, "index.html")).text(), { notes: q.get("notes") !== "0" });
        return new Response(md, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-store", ...(q.get("download") ? { "Content-Disposition": `attachment; filename="${id}.md"` } : {}) } });
      },
    },
    "/api/decks/:id/deploy": {
      POST: async (req: Req) => {
        const id = deckId(req);
        if (!id) return bad("deck", 404);
        const b = (await req.json().catch(() => null)) as { confirm?: unknown; password?: unknown } | null;
        if (!b || b.confirm !== true) return bad("confirm");
        const dm = meta(id);
        if (!dm) return bad("deck-meta"); // 공개 범위를 알 수 없으면 올리지 않는다
        const visibility = dm.visibility ?? "public";
        let pw = "";
        if (visibility === "password") {
          if (typeof b.password !== "string" || b.password.length < 8 || b.password.length > 200) return bad("password");
          pw = b.password;
        }
        if (busy) return bad("busy", 409);
        busy = true; canceled = false;
        const enc = new TextEncoder();
        // 비밀번호와 그 인코딩 변형(URL, JSON 이스케이프)을 로그에서 지운다.
        const secrets = pw ? [...new Set([pw, encodeURIComponent(pw), JSON.stringify(pw).slice(1, -1)])] : [];
        const scrub = (l: string) => secrets.reduce((t, x) => t.split(x).join("***"), l);
        const stream = new ReadableStream({
          async start(c) {
            const send = (o: unknown) => c.enqueue(enc.encode(JSON.stringify(o) + "\n"));
            try {
              send({ log: "Bundling..." });
              const bd = await run("bundler/bundle.ts", id, {}, (l) => send({ log: scrub(l) }));
              if (canceled) return send({ error: WORDS.canceled, code: "canceled" });
              if (bd.code !== 0) return send({ error: WORDS["bundle-failed"], details: bd.lines.slice(-3).map(scrub).join("\n") });
              send({ log: "Publishing..." });
              const env: Record<string, string> = pw ? { SLIDEKIT_DEPLOY_PASSWORD: pw } : {};
              if (process.env.SLIDEKIT_DEPLOY_DRY_RUN) env.SLIDEKIT_DEPLOY_DRY_RUN = "1";
              const d = await run("deploy/deploy.ts", id, env, (l) => send({ log: scrub(l) }));
              const url = d.lines.map(scrub).join("\n").match(/https:\/\/static\.vynnlee\.com\/[\w-]+/)?.[0];
              if (canceled) send({ error: WORDS.canceled, code: "canceled" });
              else if (d.code !== 0 || !url) send({ error: `The upload failed. ${why(d.lines) || "See Details."}`, details: d.lines.slice(-3).map(scrub).join("\n") });
              else send({ done: true, url, visibility, dryRun: !!process.env.SLIDEKIT_DEPLOY_DRY_RUN });
            } catch (e) { send({ error: scrub(String(e)) }); }
            finally { busy = false; c.close(); }
          },
        });
        return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
      },
    },
  };
}
export const routes = makeRoutes();
