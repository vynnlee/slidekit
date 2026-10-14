// 편집기의 Export 메뉴용 API: 번들, PDF, 다운로드, 배포. 내부는 slidekit bundle, pdf, deploy 스크립트를 자식 프로세스로 돌린다.
// 한 번에 하나만 돌린다(409). 배포는 NDJSON 스트림으로 진행 로그를 흘린다: {"log":"..."} 줄들 뒤에 {"done":true,"url":...} 또는 {"error":...}.
// 비밀번호는 자식 프로세스 환경 변수로만 넘기고, 로그와 응답에서는 지운다.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const ID = /^[a-z0-9][a-z0-9-]*$/;
const bad = (error: string, status = 400) => Response.json({ error }, { status });

type Run = (script: string, id: string, env?: Record<string, string>, onLine?: (l: string) => void) => Promise<{ code: number; lines: string[] }>;

// 실제 실행: bun <script> <id>. stdout과 stderr 줄을 모은다.
const spawnRun: Run = async (script, id, env = {}, onLine) => {
  const p = Bun.spawn(["bun", join(root, script), id], { cwd: root, env: { ...process.env, ...env }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
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
    busy = true;
    try {
      const r = await run(script, id);
      if (r.code !== 0 || !existsSync(dist(id, ext))) return bad(r.lines.slice(-3).join("\n") || "failed", 500);
      const pages = ext === "pdf" ? +(r.lines.join("\n").match(/(\d+)페이지/)?.[1] ?? 0) : undefined;
      return Response.json({ path: `dist/${id}.${ext}`, bytes: statSync(dist(id, ext)).size, pages });
    } finally { busy = false; }
  };
  return {
    "/api/decks/:id/bundle": { POST: quick("bundler/bundle.ts", "html") },
    "/api/decks/:id/pdf": { POST: quick("engine/pdf.ts", "pdf") },
    "/api/decks/:id/download": {
      GET: (req: Req) => {
        const id = deckId(req);
        if (!id) return bad("deck", 404);
        const kind = new URL(req.url).searchParams.get("kind");
        if (kind !== "html" && kind !== "pdf") return bad("kind");
        const f = Bun.file(dist(id, kind));
        if (!existsSync(dist(id, kind))) return bad("not built", 404);
        return new Response(f, { headers: {
          "Content-Type": kind === "pdf" ? "application/pdf" : "text/html; charset=utf-8",
          "Content-Disposition": `attachment; filename="${id}.${kind}"`, "Cache-Control": "no-store",
        } });
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
        busy = true;
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
              if (bd.code !== 0) return send({ error: "Bundle failed" });
              send({ log: "Publishing..." });
              const env: Record<string, string> = pw ? { SLIDEKIT_DEPLOY_PASSWORD: pw } : {};
              if (process.env.SLIDEKIT_DEPLOY_DRY_RUN) env.SLIDEKIT_DEPLOY_DRY_RUN = "1";
              const d = await run("deploy/deploy.ts", id, env, (l) => send({ log: scrub(l) }));
              const url = d.lines.map(scrub).join("\n").match(/https:\/\/static\.vynnlee\.com\/[\w-]+/)?.[0];
              if (d.code !== 0 || !url) send({ error: "Publish failed" });
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
