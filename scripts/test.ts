#!/usr/bin/env bun
// 전체 검증을 순서대로 돌린다. 실행: bun run test
// 무거운 작업이라 /tmp/slidekit-heavy.lock으로 팀 전체에서 한 번에 하나만 돌린다.
import { copyFileSync, existsSync, globSync, mkdirSync, readdirSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const root = join(import.meta.dir, "..");
const lock = "/tmp/slidekit-heavy.lock";
const first = (pattern: string) => globSync(pattern).sort().at(-1);
const PW = first(join(homedir(), ".bun/install/cache/playwright-core@*")) ?? first(join(homedir(), ".npm/_npx/*/node_modules/playwright-core"));
const CHROME = first(join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-*/chrome-headless-shell"));

for (;;) {
  try { mkdirSync(lock); break; } catch { console.log("잠금 대기 중"); await Bun.sleep(30_000); }
}

const procs: ReturnType<typeof Bun.spawn>[] = [];
// 비동기로 돌린다. 동기 실행은 같은 프로세스의 정적 서버를 막는다.
const run = async (cmd: string[], env: Record<string, string> = {}) =>
  (await Bun.spawn(["taskpolicy", "-b", ...cmd], { cwd: root, env: { ...process.env, ...env }, stdout: "inherit", stderr: "inherit" }).exited) === 0;
const waitUp = async (url: string) => { for (let i = 0; i < 50; i++) { if (await fetch(url).then((r) => r.ok).catch(() => false)) return; await Bun.sleep(200); } throw new Error(`서버가 안 뜸: ${url}`); };

const deckFile = join(root, "decks/vibe-coding-workshop/index.html");
const backup = join(root, "decks/.vibe-test-backup.html");
const commentsFile = join(root, "decks/vibe-coding-workshop/comments.json");
const hadComments = existsSync(commentsFile);
let failed = "";
try {
  const steps: [string, () => Promise<boolean> | boolean][] = [
    ["app/test/roundtrip.ts", () => run(["bun", "app/test/roundtrip.ts"])],
    ["app/test/comments.test.ts", () => run(["bun", "test", "app/test/comments.test.ts"])],
    ["deploy/worker 단위 테스트", () => run(["bun", "test", "deploy/worker"])],
    ["channel/test.ts", () => run(["bun", "channel/test.ts"], { TEST_PORT: "3242" })],
    ["engine/test/verify.cjs", async () => {
      // 저장소 루트를 정적으로 서빙한다.
      const srv = Bun.serve({ hostname: "127.0.0.1", port: 3240, fetch: (req) => {
        const f = Bun.file(join(root, decodeURIComponent(new URL(req.url).pathname)));
        return f.exists().then((ok) => (ok ? new Response(f) : new Response("", { status: 404 })));
      } });
      try { return await run(["node", "engine/test/verify.cjs"], { PW: PW!, CHROME: CHROME!, BASE: "http://127.0.0.1:3240" }); } finally { srv.stop(true); }
    }],
    ["app/test/editor.cjs", async () => {
      copyFileSync(deckFile, backup); // 편집기 검증이 덱을 고치므로 끝나면 복원한다
      const app = Bun.spawn(["taskpolicy", "-b", "bun", "run", "app/server.ts"], { cwd: root, env: { ...process.env, PORT: "3241" }, stdout: "ignore", stderr: "inherit" });
      procs.push(app);
      try {
        await waitUp("http://127.0.0.1:3241/api/decks");
        return await run(["node", "app/test/editor.cjs"], { PW: PW!, CHROME: CHROME!, BASE: "http://127.0.0.1:3241" });
      } finally { app.kill(); await app.exited; copyFileSync(backup, deckFile); Bun.spawnSync(["rm", "-f", backup, ...(hadComments ? [] : [commentsFile])]); }
    }],
  ];
  if (!PW || !CHROME) throw new Error("playwright-core 또는 headless shell을 찾지 못함");
  for (const [name, fn] of steps) {
    console.log(`\n== ${name}`);
    if (!(await fn())) { failed = name; break; }
  }
} catch (e) {
  failed ||= String(e);
} finally {
  for (const p of procs) p.kill();
  rmdirSync(lock);
}
console.log(failed ? `\nFAIL: ${failed}` : "\n전체 통과");
process.exit(failed ? 1 : 0);
