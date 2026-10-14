#!/usr/bin/env bun
// 전체 검증. 실행: bun run test [--only <이름 일부>...] [--list] [--bail] [--slow]
// 무거운 작업이라 /tmp/slidekit-heavy.lock을 한 번 잡고 모든 단계를 순서대로 돈다.
// 실제 덱은 읽기 전용이다. 덱을 고치는 테스트는 scripts/lib/test-deck.cjs의 사본(decks/_e2e-*/)만 쓴다.
// 단계 전후로 실제 덱(decks/_* 제외)의 내용 해시를 비교해 달라졌으면 WARN으로 보고만 한다(복원하지 않고 실패로도 치지 않는다). 지문은 경로와 크기다..
import { createWriteStream, globSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const root = join(import.meta.dir, "..");
const lock = "/tmp/slidekit-heavy.lock";
const args = process.argv.slice(2);
const only: string[] = [];
for (let i = 0; i < args.length; i++) if (args[i] === "--only") only.push(args[++i]);
const flag = (f: string) => args.includes(f);

const last = (pattern: string) => globSync(pattern).sort().at(-1);
const PW = last(join(homedir(), ".bun/install/cache/playwright-core@*")) ?? last(join(homedir(), ".npm/_npx/*/node_modules/playwright-core"));
const CHROME = last(join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-*/chrome-headless-shell"));

// 테스트 서버는 이 덱들에 PUT하지 못한다(실제 덱 보호). 고치는 테스트는 makeTestDeck 사본을 쓴다.
const READONLY = "vibe-coding-workshop,slidekit-guide";
// 포트: 3240 정적(엔진), 3242 채널, 3245 앱(배포 dry-run, 모든 앱 단계가 공유)
const DRY = "http://127.0.0.1:3245", APP = DRY, STATIC = "http://127.0.0.1:3240";
type Step = { name: string; cmd: string[]; env?: Record<string, string>; server?: "app" | "dry" | "static"; slow?: boolean };
const browser = (name: string, file: string, server: "app" | "dry" | "static", base: string, extra: Record<string, string> = {}): Step =>
  ({ name, cmd: ["node", file], server, env: { PW: PW ?? "", CHROME: CHROME ?? "", BASE: base, ...extra } });
const bun = (name: string, ...cmd: string[]): Step => ({ name, cmd: ["bun", ...cmd] });

const steps: Step[] = [
  bun("roundtrip", "app/test/roundtrip.ts"),
  bun("deck-source.fuzz", "app/test/deck-source.fuzz.ts"),
  bun("deck-tokens", "test", "app/test/deck-tokens.test.ts"),
  bun("deck-fonts", "test", "app/test/deck-fonts.test.ts"),
  bun("editor-readonly", "test", "app/test/editor-readonly.test.ts"),
  bun("export-api", "test", "app/test/export-api.test.ts"),
  bun("comments", "test", "app/test/comments.test.ts"),
  bun("lint", "test", "engine/test/lint.test.ts"),
  bun("bundler-bundle", "test", "bundler/test/bundle.test.ts"),
  bun("bundler-fonts", "test", "bundler/test/fonts.test.ts"),
  bun("scan-secrets", "test", "scripts/scan-secrets.test.ts"),
  bun("deploy-worker", "test", "deploy/worker"),
  { name: "channel", cmd: ["bun", "channel/test.ts"], env: { TEST_PORT: "3242" } },
  { name: "channel-resilience", cmd: ["bun", "channel/resilience.ts"], env: { TEST_PORT: "3247" } },
  browser("engine-verify", "engine/test/verify.cjs", "static", STATIC),
  { ...browser("engine-moved", "engine/test/moved.cjs", "static", STATIC), server: undefined }, // file:// 로 연다
  browser("routes", "app/test/routes.cjs", "app", APP),
  browser("list", "app/test/list.cjs", "app", APP),
  browser("present", "app/test/present.cjs", "app", APP),
  browser("responsive", "app/test/responsive.cjs", "app", APP),
  browser("inspector", "app/test/inspector.cjs", "app", APP),
  browser("inspector-a11y", "app/test/inspector-a11y.cjs", "app", APP),
  browser("editor", "app/test/editor.cjs", "app", APP),
  browser("comments-e2e", "app/test/comments-e2e.cjs", "app", APP),
  browser("tokens", "app/test/tokens.cjs", "dry", DRY),
  browser("export", "app/test/export.cjs", "dry", DRY),
  // 인터넷과 uv가 필요해 --slow 또는 --only로만 돈다.
  { ...browser("bundler-fonts-e2e", "bundler/test/fonts.cjs", "static", STATIC), server: undefined, slow: true },
];

if (flag("--list")) { console.log(steps.map((s) => s.name + (s.slow ? " (slow)" : "")).join("\n")); process.exit(0); }
const picked = steps.filter((s) => (only.length ? only.some((o) => s.name.includes(o)) : !s.slow || flag("--slow")));
if (!picked.length) { console.error("맞는 단계가 없음. --list로 확인"); process.exit(2); }
if (picked.some((s) => s.cmd[0] === "node") && (!PW || !CHROME)) { console.error("playwright-core 또는 headless shell을 찾지 못함"); process.exit(2); }

const servers = new Map<string, () => void>();
// 공정한 대기열: /tmp/slidekit-heavy.queue/<시각>-<pid> 표를 받고, 살아 있는 표 중 가장 앞일 때만 잠금을 시도한다.
// 손으로 mkdir 하는 팀원과도 같은 잠금 디렉터리를 공유한다(pid 파일에는 보유자 이름을 적는다).
const queue = "/tmp/slidekit-heavy.queue";
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const holder = () => { try { return readFileSync(join(lock, "pid"), "utf8").trim() || "알 수 없음"; } catch { return "알 수 없음"; } };
mkdirSync(queue, { recursive: true });
const ticket = join(queue, `${Date.now().toString().padStart(14, "0")}-${process.pid}`);
writeFileSync(ticket, "");
let held = false;
const release = () => { rmSync(ticket, { force: true }); if (held) { held = false; try { rmSync(lock, { recursive: true }); } catch {} } };
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { for (const stop of servers.values()) stop(); release(); process.exit(130); });
{
  let lastMsg = "", lastAt = 0;
  for (;;) {
    const live = readdirSync(queue).filter((n) => alive(Number(n.split("-")[1]))).sort();
    for (const n of readdirSync(queue)) if (!live.includes(n)) rmSync(join(queue, n), { force: true }); // 죽은 대기자의 표
    const pos = live.indexOf(ticket.split("/").pop()!);
    if (pos === 0) {
      try { mkdirSync(lock); writeFileSync(join(lock, "pid"), `test-runner pid=${process.pid}`); held = true; break; } catch {}
    }
    // 같은 메시지는 5분에 한 번만 다시 찍는다.
    const h = holder(), m = `잠금 대기: 앞에 ${pos}명, 보유자 ${h}`;
    if (m !== lastMsg || Date.now() - lastAt > 300_000) { console.log(m); lastMsg = m; lastAt = Date.now(); }
    // 보유자가 test-runner인데 죽었으면 남은 잠금이다.
    const dead = h.match(/^test-runner pid=(\d+)/);
    if (dead && !alive(Number(dead[1]))) { console.log("죽은 test-runner의 잠금을 치웁니다"); rmSync(lock, { recursive: true, force: true }); continue; }
    await Bun.sleep(5_000);
  }
}
console.log(`잠금 획득 (pid ${process.pid})`);

// 단계 출력은 화면과 /tmp/slidekit-test-logs/<단계>.log에 함께 남긴다(실패 때 다시 볼 수 있게).
const logDir = "/tmp/slidekit-test-logs";
mkdirSync(logDir, { recursive: true });
async function run(name: string, cmd: string[], env: Record<string, string> = {}) {
  const out = createWriteStream(join(logDir, `${name}.log`));
  const p = Bun.spawn(["taskpolicy", "-b", ...cmd], { cwd: root, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  // 출력 사이가 3초 넘게 벌어지면 "[느림 +N초]" 줄을 넣는다. 고정 sleep과 긴 대기가 어느 검사 앞에 있는지 찾는 용도다.
  let prev = Date.now();
  const pump = async (s: ReadableStream<Uint8Array>, to: NodeJS.WriteStream) => {
    for await (const c of s) {
      const now = Date.now(), gap = (now - prev) / 1000; prev = now;
      if (gap > 3) { const m = `[느림 +${gap.toFixed(1)}초]\n`; to.write(m); out.write(m); }
      to.write(c); out.write(c);
    }
  };
  await Promise.all([pump(p.stdout, process.stdout), pump(p.stderr, process.stderr)]);
  out.end();
  return p.exited;
}
const waitUp = async (url: string) => {
  for (let i = 0; i < 75; i++) { if (await fetch(`${url}/api/decks`).then((r) => r.ok).catch(() => false)) return; await Bun.sleep(200); }
  throw new Error(`서버가 안 뜸: ${url}`);
};

// 서버는 처음 필요할 때 띄우고 끝까지 둔다.
async function ensure(kind: "app" | "dry" | "static") {
  if (kind !== "static") kind = "dry";
  if (servers.has(kind)) return;
  if (kind === "static") {
    const srv = Bun.serve({ hostname: "127.0.0.1", port: 3240, fetch: (req) => {
      const f = Bun.file(join(root, decodeURIComponent(new URL(req.url).pathname)));
      return f.exists().then((ok) => (ok ? new Response(f) : new Response("", { status: 404 })));
    } });
    servers.set(kind, () => srv.stop(true));
    return;
  }
  // 앱 서버 하나(deploy dry-run 켬)를 app과 dry가 같이 쓴다. 서버를 두 번 띄우고 첫 빌드를 두 번 치르지 않는다.
  // export.cjs가 서버 로그(/tmp/sk-eng-srv.log)에 비밀번호가 없는지 검사하므로 dry-run 서버의 출력을 거기에 남긴다.
  const log = Bun.file("/tmp/sk-eng-srv.log");
  const p = Bun.spawn(["taskpolicy", "-b", "bun", "run", "app/server.ts"], {
    cwd: root, stdout: log, stderr: log,
    env: { ...process.env, PORT: "3245", SLIDEKIT_STABLE: "1", SLIDEKIT_READONLY_DECKS: READONLY, SLIDEKIT_DEPLOY_DRY_RUN: "1" },
  });
  servers.set(kind, () => p.kill());
  await waitUp(DRY);
}

// 이전 실행이 중단되어 남은 export 테스트 덱(qa-exp-*)만 지운다. 이름을 _로 못 바꾸는 테스트 전용 덱이다.
for (const d of globSync(join(root, "decks/qa-exp-*"))) rmSync(d, { recursive: true, force: true });

// 실제 덱 지문: decks/ 아래에서 이름이 _로 시작하는 최상위 항목(테스트 사본)과 .trash, 임시 파일을 뺀 모든 파일의 경로와 내용.
const decksDir = join(root, "decks");
function fingerprint() {
  const h = new Bun.CryptoHasher("sha1");
  const walk = (dir: string, top: boolean) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (top && (e.name.startsWith("_") || e.name === ".trash")) continue;
      if (e.name.includes(".tmp-")) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) { h.update(`d:${p}\n`); walk(p, false); }
      else { try { const st = statSync(p); h.update(`f:${p}:${st.size}\n`); } catch {} } // 내용 대신 크기(단계마다 전체를 읽지 않는다). 수정 시각은 channel 테스트가 utimes로 건드려 뺐다
    }
  };
  walk(decksDir, true);
  return h.digest("hex");
}

const warned: string[] = [];
const results: [string, boolean, number][] = [];
try {
  for (const s of picked) {
    console.log(`\n== ${s.name}`);
    const t0 = Date.now();
    let before = fingerprint();
    let ok = false;
    try {
      if (s.server) await ensure(s.server);
      ok = (await run(s.name, s.cmd, s.env)) === 0;
    } catch (e) { console.log(String(e)); }
    const after = fingerprint();
    // 사용자나 다른 팀원이 같은 시각에 편집했을 수 있어 실패로 치지 않고 경고만 한다. 복원하지 않는다.
    if (after !== before) { console.log(`WARN ${s.name}: 실제 덱(decks/)이 테스트 중에 바뀜(외부 편집 가능성). 복원하지 않음, git diff decks/ 확인`); warned.push(s.name); }
    const sec = (Date.now() - t0) / 1000;
    results.push([s.name, ok, sec]);
    console.log(`-- ${s.name}: ${ok ? "통과" : "실패"} ${sec.toFixed(1)}초`);
    if (!ok && flag("--bail")) break;
  }
} finally {
  for (const stop of servers.values()) stop();
  release();
}

console.log("\n" + results.map(([n, ok, t]) => `${ok ? "PASS" : "FAIL"} ${n} ${t.toFixed(1)}초`).join("\n"));
const total = results.reduce((a, [, , t]) => a + t, 0);
console.log(`\n합계 ${total.toFixed(0)}초. 오래 걸린 단계: ` + [...results].sort((a, b) => b[2] - a[2]).slice(0, 3).map(([n, , t]) => `${n} ${t.toFixed(0)}초`).join(", "));
const failed = results.filter(([, ok]) => !ok).map(([n]) => n);
if (warned.length) console.log(`\nWARN: 실제 덱이 바뀐 단계 ${warned.join(", ")}`);
if (failed.length) {
  console.log(`\nFAIL: ${failed.join(", ")}`);
  for (const n of failed) console.log(`  다시 실행: bun run test --only ${n}   로그: ${logDir}/${n}.log` + (n === "export" || n === "tokens" ? "   서버 로그: /tmp/sk-eng-srv.log" : ""));
} else console.log("\n전체 통과");
process.exit(failed.length ? 1 : 0);
