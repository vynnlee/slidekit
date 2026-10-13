#!/usr/bin/env bun
// 전체 검증. 실행: bun run test [--only <이름 일부>...] [--list] [--bail] [--slow]
// 무거운 작업이라 /tmp/slidekit-heavy.lock을 한 번 잡고 모든 단계를 순서대로 돈다.
// decks/는 시작 때 복사해 두고 단계마다 되돌린다(테스트가 만든 덱, comments.json, 편집한 덱 정리).
import { cpSync, globSync, mkdirSync, mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";

const root = join(import.meta.dir, "..");
const lock = "/tmp/slidekit-heavy.lock";
const args = process.argv.slice(2);
const only: string[] = [];
for (let i = 0; i < args.length; i++) if (args[i] === "--only") only.push(args[++i]);
const flag = (f: string) => args.includes(f);

const last = (pattern: string) => globSync(pattern).sort().at(-1);
const PW = last(join(homedir(), ".bun/install/cache/playwright-core@*")) ?? last(join(homedir(), ".npm/_npx/*/node_modules/playwright-core"));
const CHROME = last(join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-*/chrome-headless-shell"));

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
  const p = spawn(["bun", "run", "app/server.ts"], { PORT: dry ? "3245" : "3241", ...(dry ? { SLIDEKIT_DEPLOY_DRY_RUN: "1" } : {}) });
  servers.set(kind, () => p.kill());
  await waitUp(dry ? DRY : APP);
}

// decks/ 스냅샷: 단계마다 시작 상태로 되돌린다.
const snap = mkdtempSync(join(tmpdir(), "slidekit-decks-"));
cpSync(join(root, "decks"), snap, { recursive: true });
const restore = () => Bun.spawnSync(["rsync", "-a", "--delete", `${snap}/`, `${join(root, "decks")}/`]);

const results: [string, boolean, number][] = [];
try {
  for (const s of picked) {
    console.log(`\n== ${s.name}`);
    const t0 = Date.now();
    let ok = false;
    try {
      if (s.server) await ensure(s.server);
      ok = (await spawn(s.cmd, s.env).exited) === 0;
    } catch (e) { console.log(String(e)); }
    restore();
    const sec = (Date.now() - t0) / 1000;
    results.push([s.name, ok, sec]);
    console.log(`-- ${s.name}: ${ok ? "통과" : "실패"} ${sec.toFixed(1)}초`);
    if (!ok && flag("--bail")) break;
  }
} finally {
  for (const stop of servers.values()) stop();
  restore();
  rmSync(snap, { recursive: true, force: true });
  rmdirSync(lock);
}

console.log("\n" + results.map(([n, ok, t]) => `${ok ? "PASS" : "FAIL"} ${n} ${t.toFixed(1)}초`).join("\n"));
const failed = results.filter(([, ok]) => !ok).map(([n]) => n);
console.log(failed.length ? `\nFAIL: ${failed.join(", ")}` : "\n전체 통과");
process.exit(failed.length ? 1 : 0);
