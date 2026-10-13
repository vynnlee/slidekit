#!/usr/bin/env bun
// 전체 검증. 실행: bun run test [--only <이름 일부>...] [--list] [--bail] [--slow]
// 무거운 작업이라 /tmp/slidekit-heavy.lock을 한 번 잡고 모든 단계를 순서대로 돈다.
// 실제 덱은 읽기 전용이다. 덱을 고치는 테스트는 scripts/lib/test-deck.cjs의 사본(decks/_e2e-*/)만 쓴다.
// 단계 전후로 실제 덱(decks/_* 제외)의 내용 해시를 비교해 달라졌으면 WARN으로 보고만 한다(복원하지 않고 실패로도 치지 않는다).
import { globSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync } from "node:fs";
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
// 포트: 3240 정적(엔진), 3241 앱, 3242 채널, 3245 앱(배포 dry-run)
const APP = "http://127.0.0.1:3241", DRY = "http://127.0.0.1:3245", STATIC = "http://127.0.0.1:3240";
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
  browser("engine-verify", "engine/test/verify.cjs", "static", STATIC),
  browser("routes", "app/test/routes.cjs", "app", APP),
  browser("list", "app/test/list.cjs", "app", APP),
  browser("present", "app/test/present.cjs", "app", APP),
  browser("responsive", "app/test/responsive.cjs", "app", APP),
  browser("inspector", "app/test/inspector.cjs", "app", APP),
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

for (;;) {
  try { mkdirSync(lock); break; } catch { console.log("잠금 대기 중"); await Bun.sleep(30_000); }
}

const spawn = (cmd: string[], env: Record<string, string> = {}) =>
  Bun.spawn(["taskpolicy", "-b", ...cmd], { cwd: root, env: { ...process.env, ...env }, stdout: "inherit", stderr: "inherit" });
const waitUp = async (url: string) => {
  for (let i = 0; i < 75; i++) { if (await fetch(`${url}/api/decks`).then((r) => r.ok).catch(() => false)) return; await Bun.sleep(200); }
  throw new Error(`서버가 안 뜸: ${url}`);
};

// 서버는 처음 필요할 때 띄우고 끝까지 둔다.
const servers = new Map<string, () => void>();
async function ensure(kind: "app" | "dry" | "static") {
  if (servers.has(kind)) return;
  if (kind === "static") {
    const srv = Bun.serve({ hostname: "127.0.0.1", port: 3240, fetch: (req) => {
      const f = Bun.file(join(root, decodeURIComponent(new URL(req.url).pathname)));
      return f.exists().then((ok) => (ok ? new Response(f) : new Response("", { status: 404 })));
    } });
    servers.set(kind, () => srv.stop(true));
    return;
  }
  const dry = kind === "dry";
  // export.cjs가 서버 로그(/tmp/sk-eng-srv.log)에 비밀번호가 없는지 검사하므로 dry-run 서버의 출력을 거기에 남긴다.
  const log = dry ? Bun.file("/tmp/sk-eng-srv.log") : "ignore";
  const p = Bun.spawn(["taskpolicy", "-b", "bun", "run", "app/server.ts"], {
    cwd: root, stdout: log, stderr: log,
    env: { ...process.env, PORT: dry ? "3245" : "3241", SLIDEKIT_READONLY_DECKS: READONLY, ...(dry ? { SLIDEKIT_DEPLOY_DRY_RUN: "1" } : {}) },
  });
  servers.set(kind, () => p.kill());
  await waitUp(dry ? DRY : APP);
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
      else { h.update(`f:${p}\n`); try { h.update(readFileSync(p)); } catch {} }
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
      ok = (await spawn(s.cmd, s.env).exited) === 0;
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
  rmdirSync(lock);
}

console.log("\n" + results.map(([n, ok, t]) => `${ok ? "PASS" : "FAIL"} ${n} ${t.toFixed(1)}초`).join("\n"));
const failed = results.filter(([, ok]) => !ok).map(([n]) => n);
if (warned.length) console.log(`\nWARN: 실제 덱이 바뀐 단계 ${warned.join(", ")}`);
console.log(failed.length ? `\nFAIL: ${failed.join(", ")}` : "\n전체 통과");
process.exit(failed.length ? 1 : 0);
