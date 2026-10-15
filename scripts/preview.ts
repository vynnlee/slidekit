#!/usr/bin/env bun
// 미리보기 감독자. 두 가지 미리보기를 띄우고 죽으면 다시 띄운다.
//   Live   작업트리를 그대로 읽는 개발 서버(HMR). 팀원이 저장하는 중간 상태가 보이고 가끔 깨진다. 3220 -> 프록시 3221
//   Stable main 최신 커밋의 스냅샷으로 띄운 서버(HMR 없음). 새 커밋이 생기면 옆에 새로 띄워 건강할 때만 바꾸고, 실패하면 이전 것을 유지한다.
//          앱 코드는 스냅샷이고 decks/는 실제 저장소 폴더를 가리키는 심볼릭 링크라 편집 내용은 실제 덱에 저장된다. 3250/3251 -> 프록시 3230
// 안정판은 푸시된 커밋(origin/main)만 따른다: 로컬에만 있는 미완성·미검증 커밋은 보이지 않는다.
// 사용: nohup bun scripts/preview.ts > /tmp/sk-preview.log 2>&1 &   (종료는 이 프로세스의 pid에만 SIGTERM)
// tailnet에는 프록시 포트(3221, 3230)를 homelab-preview 도구로 연다. 프록시는 Host와 Origin을 검사하고 Host를 로컬로 다시 쓴다.
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const repo = join(import.meta.dir, "..");
const LIVE = { app: 3220, proxy: 3221 };
const LIVE_ON = process.env.PREVIEW_LIVE !== "0"; // PREVIEW_LIVE=0이면 라이브(작업트리) 서버와 프록시를 띄우지 않고 안정판만 띄운다(발열 부담이 작다)
const STABLE = { proxy: 3230, apps: [3250, 3251] };
const SNAP_ROOT = "/tmp/sk-stable";
const PID_FILE = "/tmp/sk-preview.pid";
const allowedHosts = new Set(["127.0.0.1", "localhost", "mac-cloud.tail5a652b.ts.net"]);
const log = (...a: unknown[]) => console.log(new Date().toTimeString().slice(0, 8), ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (existsSync(PID_FILE)) {
  const old = Number(readFileSync(PID_FILE, "utf8"));
  try { process.kill(old, 0); console.error(`이미 실행 중 (pid ${old})`); process.exit(1); } catch {}
}
writeFileSync(PID_FILE, String(process.pid));

const sh = (cmd: string[], cwd = repo) => Bun.spawnSync(cmd, { cwd }).stdout.toString().trim();
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const killPid = (pid?: number) => { if (pid && alive(pid)) process.kill(pid, "SIGTERM"); };

async function getJson(port: number, path: string) {
  try { const r = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(3000) }); return r; } catch { return null; }
}
// Live는 번들이 중간에 깨질 수 있어 API로만 건강을 본다. Stable은 첫 화면이 Build Failed가 아닌지도 본다.
async function healthy(port: number, strict: boolean) {
  const api = await getJson(port, "/api/decks");
  if (!api || !api.ok || !Array.isArray(await api.json().catch(() => null))) return false;
  if (!strict) return true;
  const page = await getJson(port, "/");
  return !!page && page.status === 200 && !(await page.text()).includes("Build Failed");
}
async function waitHealthy(port: number, strict: boolean, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await healthy(port, strict)) return true; await sleep(700); }
  return false;
}
function startServer(cwd: string, port: number, stable: boolean) {
  const env = { ...process.env, PORT: String(port), ...(stable ? { SLIDEKIT_STABLE: "1" } : {}) };
  // exec로 sh를 bun으로 바꿔 pid가 서버 자신이 되게 한다.
  const p = Bun.spawn(["sh", "-c", `exec bun app/server.ts >> /tmp/sk-preview-${port}.log 2>&1`], { cwd, env, stdout: "ignore", stderr: "ignore" });
  return p.pid;
}

// ---------- 프록시 ----------
type WsData = { url: string; upstream?: WebSocket; queue: (string | Buffer)[] };
function serveProxy(listen: number, upstream: () => number | null, label: () => string, status?: () => unknown) {
  Bun.serve<WsData>({
    hostname: "127.0.0.1",
    port: listen,
    async fetch(req, server) {
      const u = new URL(req.url);
      const host = req.headers.get("host") ?? "", origin = req.headers.get("origin");
      if (!allowedHosts.has(host.replace(/:\d+$/, "")) || (origin && new URL(origin).host !== host)) return new Response("forbidden", { status: 403 });
      if (status && u.pathname === "/__preview") return Response.json(status());
      const port = upstream();
      if (!port) return new Response("preview starting", { status: 503, headers: { "retry-after": "3" } });
      const local = `127.0.0.1:${port}`;
      if (req.headers.get("upgrade") === "websocket") {
        return server.upgrade(req, { data: { url: `ws://${local}${u.pathname}${u.search}`, queue: [] } }) ? undefined : new Response("upgrade failed", { status: 400 });
      }
      const headers = new Headers(req.headers);
      headers.set("host", local);
      headers.delete("origin");
      try {
        const r = await fetch(`http://${local}${u.pathname}${u.search}`, { method: req.method, headers, body: req.body, redirect: "manual" });
        const out = new Response(r.body, r);
        out.headers.set("x-slidekit-preview", label());
        return out;
      } catch { return new Response("preview upstream unavailable", { status: 502, headers: { "retry-after": "3" } }); }
    },
    websocket: {
      open(ws) {
        const up = new WebSocket(ws.data.url, { headers: { origin: `http://${new URL(ws.data.url).host}` } } as never);
        ws.data.upstream = up;
        up.onopen = () => ws.data.queue.splice(0).forEach((m) => up.send(m as string));
        up.onmessage = (e) => ws.send(e.data as string);
        up.onclose = () => ws.close();
      },
      message(ws, m) { const up = ws.data.upstream!; up.readyState === WebSocket.OPEN ? up.send(m as string) : ws.data.queue.push(m); },
      close(ws) { ws.data.upstream?.close(); },
    },
  });
}

// ---------- Live ----------
const live = { pid: 0, files: "", bad: 0 };
// 새 파일이 생기면 Bun 개발 서버는 다시 띄워야 번들을 찾는다. 파일 목록이 바뀔 때 다시 띄운다.
const fileList = () => sh(["git", "ls-files", "-co", "--exclude-standard", "app", "engine"]).split("\n").filter((f) => /\.(tsx?|css|html)$/.test(f)).sort().join("\n");
async function ensureLive() {
  const files = fileList();
  const dead = !live.pid || !alive(live.pid);
  if (!dead && files !== live.files) { log("live: 파일 목록이 바뀌어 다시 띄움"); killPid(live.pid); await sleep(800); }
  else if (!dead && !(await healthy(LIVE.app, false))) { if (++live.bad < 3) return; log("live: 응답 없음, 다시 띄움"); killPid(live.pid); await sleep(800); }
  else if (!dead) { live.bad = 0; return; }
  live.bad = 0;
  live.files = files;
  live.pid = startServer(repo, LIVE.app, false);
  log(`live: 시작 pid ${live.pid} :${LIVE.app}`);
}

// ---------- Stable ----------
const stable: { sha: string; port: number; dir: string; pid: number; since: string } = { sha: "", port: 0, dir: "", pid: 0, since: "" };
let failedSha = "";
let lastError = "";
function snapshot(sha: string) {
  const dir = join(SNAP_ROOT, sha.slice(0, 10));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  Bun.spawnSync(["sh", "-c", `git -C '${repo}' archive ${sha} | tar -x -C '${dir}'`]);
  rmSync(join(dir, "decks"), { recursive: true, force: true }); // 덱은 스냅샷이 아니라 실제 폴더를 쓴다
  symlinkSync(join(repo, "decks"), join(dir, "decks"));
  symlinkSync(join(repo, "node_modules"), join(dir, "node_modules"));
  return dir;
}
async function deployStable(sha: string) {
  const port = STABLE.apps.find((p) => p !== stable.port)!;
  killPid(Number(sh(["lsof", "-ti", `tcp:${port}`, "-sTCP:LISTEN"]).split("\n")[0]) || undefined); // 이전 실패로 남은 서버
  const dir = snapshot(sha);
  const pid = startServer(dir, port, true);
  log(`stable: ${sha.slice(0, 7)} 시험 기동 :${port}`);
  if (!(await waitHealthy(port, true, 45000))) {
    lastError = `${sha.slice(0, 7)} 기동 실패, 이전 버전 유지`;
    log("stable:", lastError);
    killPid(pid); rmSync(dir, { recursive: true, force: true });
    failedSha = sha;
    return;
  }
  const old = { ...stable };
  Object.assign(stable, { sha, port, dir, pid, since: new Date().toISOString() });
  lastError = ""; failedSha = "";
  log(`stable: ${sha.slice(0, 7)} 적용 (프록시 ${STABLE.proxy} -> :${port})`);
  if (old.pid) setTimeout(() => { killPid(old.pid); rmSync(old.dir, { recursive: true, force: true }); }, 30000); // 열린 SSE가 정리되도록 잠시 둔다
}
async function ensureStable() {
  const sha = sh(["git", "rev-parse", "origin/main"]);
  if (!sha) return;
  if (stable.pid && !alive(stable.pid)) { log("stable: 서버가 죽음, 같은 스냅샷으로 다시 띄움"); stable.pid = startServer(stable.dir, stable.port, true); await waitHealthy(stable.port, true, 30000); return; }
  if (sha !== stable.sha && sha !== failedSha) await deployStable(sha);
}

if (LIVE_ON) serveProxy(LIVE.proxy, () => (live.pid ? LIVE.app : null), () => "live");
serveProxy(STABLE.proxy, () => (stable.pid ? stable.port : null), () => `stable ${stable.sha.slice(0, 7)}`, () => ({ sha: stable.sha, since: stable.since, port: stable.port, lastError, failedSha }));

const stop = () => { killPid(live.pid); killPid(stable.pid); rmSync(PID_FILE, { force: true }); process.exit(0); };
process.on("SIGINT", stop); process.on("SIGTERM", stop);

log(`미리보기 감독 시작 pid ${process.pid}: live ${LIVE.proxy}, stable ${STABLE.proxy}`);
while (true) {
  if (LIVE_ON) try { await ensureLive(); } catch (e) { log("live 오류", e); }
  try { await ensureStable(); } catch (e) { log("stable 오류", e); }
  await sleep(4000);
}
