#!/usr/bin/env bun
// 전체 검증. 실행: bun run test [--only <이름|글로브|그룹>...] [--changed [--base <ref>] [--dry-run]] [--list] [--bail] [--slow]
// 평소에는 `bun run test:changed`(변경 파일에 해당하는 단계만)를 쓰고, 전체 게이트는 푸시 전에만 돌린다.
// 무거운 작업이라 /tmp/slidekit-heavy.lock을 한 번 잡고 모든 단계를 순서대로 돈다.
// 실제 덱은 읽기 전용이다. 덱을 고치는 테스트는 scripts/lib/test-deck.cjs의 사본(decks/_e2e-*/)만 쓴다.
// 단계 전후로 실제 덱(decks/_* 제외)의 내용 해시를 비교해 달라졌으면 WARN으로 보고만 한다(복원하지 않고 실패로도 치지 않는다). 지문은 경로와 크기다..
import { createWriteStream, globSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { ALIASES, selectSteps } from "./lib/select-steps";
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
  { name: "channel-trust", cmd: ["bun", "channel/trust.ts"], env: { TEST_PORT: "3248" } },
  browser("engine-verify", "engine/test/verify.cjs", "static", STATIC),
  { ...browser("engine-moved", "engine/test/moved.cjs", "static", STATIC), server: undefined }, // file:// 로 연다
  { ...browser("engine-gradient", "engine/test/gradient.cjs", "static", STATIC), server: undefined }, // file:// 로 연다, PDF 바이트의 셰이딩까지 본다
  browser("routes", "app/test/routes.cjs", "app", APP),
  browser("list", "app/test/list.cjs", "app", APP),
  browser("present", "app/test/present.cjs", "app", APP),
  browser("remote", "app/test/remote.cjs", "app", APP),
  browser("responsive", "app/test/responsive.cjs", "app", APP),
  browser("controls", "app/test/controls.cjs", "app", APP),
  browser("inspector", "app/test/inspector.cjs", "app", APP),
  browser("inspector-a11y", "app/test/inspector-a11y.cjs", "app", APP),
  browser("editor", "app/test/editor.cjs", "app", APP),
  browser("editor-assets", "app/test/editor-assets.cjs", "app", APP),
  browser("comments-e2e", "app/test/comments-e2e.cjs", "app", APP),
  browser("editor-multi", "app/test/editor-multi.cjs", "app", APP),
  browser("editor-menus", "app/test/editor-menus.cjs", "app", APP),
  browser("editor-panels", "app/test/editor-panels.cjs", "app", APP),
  browser("versions-e2e", "app/test/versions-e2e.cjs", "app", APP),
  browser("tokens", "app/test/tokens.cjs", "dry", DRY),
  browser("export", "app/test/export.cjs", "dry", DRY),
  // 인터넷과 uv가 필요해 --slow 또는 --only로만 돈다.
  // 코멘트 화면 스크린샷(눈으로 보는 용도, 통과 기준 없음). --only ux-shots로 돌리면 /tmp/slidekit-ux-shots/<폭>/에 저장된다.
  { ...browser("ux-shots-1440", "scripts/ux-shots-comments2.cjs", "app", APP, { VIEWPORT: "1440x900", OUT: "/tmp/slidekit-ux-shots/1440" }), slow: true },
  { ...browser("ux-shots-390", "scripts/ux-shots-comments2.cjs", "app", APP, { VIEWPORT: "390x844", OUT: "/tmp/slidekit-ux-shots/390" }), slow: true },
  // 덱 30개 목록의 부하 한도 검사(동시에 올라 있는 썸네일 수와 브라우저 메모리). 측정이 길어 --slow 또는 --only로만 돈다.
  { ...browser("list-load", "app/test/list-load.cjs", "app", APP, { CHECK: "1" }), slow: true },
  { ...browser("bundler-fonts-e2e", "bundler/test/fonts.cjs", "static", STATIC), server: undefined, slow: true },
];

// 어느 단계에도 없는 단위 테스트(*.test.ts)는 한 단계로 묶어 돈다. 새 테스트를 추가해도 게이트에서 빠지지 않는다.
{
  const used = steps.flatMap((st) => st.cmd);
  const extra = globSync("{app,engine,bundler,channel,scripts,deploy}/**/*.test.ts", { cwd: root }).filter((f) => !f.includes("node_modules") && !used.includes(f) && !used.some((u) => f.startsWith(u + "/")));
  // SLIDEKIT_DECKS를 임시 폴더로 바꾸는 테스트는 folder.ts 같은 모듈이 처음 불러올 때 그 값을 굳혀서, 한 프로세스에 섞이면 서로를 깨뜨린다. 그런 파일은 따로따로 돈다.
  const isolated = extra.filter((f) => readFileSync(join(root, f), "utf8").includes("SLIDEKIT_DECKS"));
  const shared = extra.filter((f) => !isolated.includes(f));
  const at = steps.findIndex((st) => st.name === "channel");
  if (isolated.length) steps.splice(at, 0, { name: "unit-isolated", cmd: ["sh", "-c", isolated.map((f) => `bun test ${f}`).join(" && ")] });
  if (shared.length) steps.splice(at, 0, { name: "unit-other", cmd: ["bun", "test", ...shared] });
}
if (flag("--list")) { console.log(steps.map((s) => s.name + (s.slow ? " (slow)" : "")).join("\n")); console.log("\n그룹(--only 별칭): " + Object.entries(ALIASES).map(([k, v]) => `${k} = ${v.join(", ")}`).join(" | ") + "\n글로브: --only 'editor*' (이름이 정확히 일치하는 단계만 고르는 것이 기본)"); process.exit(0); }
// 변경 파일 -> 단계 매핑표(여기 한 곳). 규칙은 모두 적용해 단계를 합친다. 문서만 바뀌면 단계가 없다.
const NOSTEP = /^(package\.json|bun\.lock|\.gitignore|\.githooks\/|tsconfig.*\.json)$/;
const DOCS = /(^|\/)(HANDOFF|README|PLAN|SKILL|INTERACTION|SPEC)\.md$|^(spec|docs)\/|\.md$/;
const EDITOR_ALL = ["editor", "editor-assets", "editor-multi", "editor-menus", "editor-panels"]; // 편집기 브라우저 검증은 영역별 파일로 나뉘어 있다(app/test/editor-*.cjs, 하네스는 app/test/lib/editor-harness.cjs)
const BROWSER_APP = ["routes", "responsive", "list"]; // 앱 공통 화면 변경 때의 연기 검사
const MAP: [RegExp, string[]][] = [
  [/^engine\/(slidekit\.(js|css)|test\/(verify|moved|gradient)\.cjs)/, ["engine-verify", "engine-moved", "engine-gradient", "bundler-bundle"]],
  [/^engine\/(lint\.ts|test\/lint\.test\.ts|doctor\.ts|new\.ts|template\/)/, ["lint", "tokens"]],
  [/^bundler\//, ["bundler-bundle", "bundler-fonts"]],
  [/^deploy\//, ["deploy-worker", "export-api"]],
  [/^channel\//, ["channel"]],
  [/^app\/(comments\.ts|src\/(Comment|lib\/(comment|use-comments))|test\/comments)/, ["comments", "channel", "comments-e2e"]],
  [/^app\/(versions\.ts|src\/(VersionHistory|ExportMenu)|test\/versions)/, ["versions", "versions-e2e"]],
  [/^app\/(export-api\.ts|src\/ExportMenu)/, ["export-api", "export"]],
  [/^app\/(editor-api\.ts|src\/lib\/(deck-source|move|selection|guides))/, ["roundtrip", "deck-source.fuzz", "editor-readonly", "editor", "inspector"]],
  [/^app\/src\/(Editor|Canvas|LayerTree|Filmstrip|Notes)/, [...EDITOR_ALL, "inspector"]],
  [/^app\/src\/(FindBar|DeckSettings|EditorTip|lib\/(find|overflow|deck-meta))/, ["editor-assets"]],
  [/^app\/test\/editor-assets\.cjs/, ["editor-assets"]],
  [/^app\/test\/(editor\.cjs|lib\/editor-harness\.cjs)/, EDITOR_ALL],
  [/^app\/src\/(Inspector|components\/inspector)/, ["inspector", "inspector-a11y", "editor"]],
  [/^app\/src\/(TokensPanel|harness\/TokensDemo|lib\/deck-(tokens|fonts))|^app\/test\/deck-(tokens|fonts)/, ["deck-tokens", "deck-fonts", "tokens"]],
  [/^app\/src\/harness\/InspectorDemo/, ["inspector", "inspector-a11y"]],
  [/^app\/src\/(components\/ui\/|lib\/control-surface|index\.css|harness\/ControlStates)|^app\/test\/controls/, ["controls"]],
  [/^app\/src\/harness\/ExportDemo/, ["export"]],
  [/^app\/src\/(Presenter|lib\/present)/, ["present"]],
  [/^app\/src\/(DeckList|TrashList|lib\/menu-model|components\/ui\/context-menu)/, ["list"]],
  [/^app\/(server|guard|decks-api|folder|preview-proxy)\.ts/, ["routes", "list", "editor-readonly", "export-api"]],
  [/^app\/(remote-api\.ts|src\/(Remote|lib\/remote-host))|^app\/test\/remote/, ["remote", "unit-other"]],
  [/^app\/src\//, BROWSER_APP],
  [/^scripts\/(test\.ts|scan-secrets)/, ["scan-secrets"]],
  [/^engine\/outline/, ["unit-other"]],
  [/\.test\.ts$/, ["unit-other", "unit-isolated"]],
];
function changedSteps(): { names: string[]; files: string[]; unknown: string[] } {
  const base = args.includes("--base") ? args[args.indexOf("--base") + 1] : Bun.spawnSync(["git", "rev-parse", "--verify", "-q", "origin/main"], { cwd: root }).exitCode === 0 ? "origin/main" : "HEAD";
  const git = (...a: string[]) => Bun.spawnSync(["git", ...a], { cwd: root }).stdout.toString().split("\n").filter(Boolean);
  const files = [...new Set([...git("diff", "--name-only", base), ...git("ls-files", "-o", "--exclude-standard")])].filter((f) => !f.startsWith("decks/"));
  const names = new Set<string>(), unknown: string[] = [];
  for (const f of files) {
    if (DOCS.test(f) || NOSTEP.test(f)) continue;
    const hit = MAP.filter(([re]) => re.test(f));
    hit.forEach(([, n]) => n.forEach((x) => names.add(x)));
    // 테스트 파일 자체가 바뀌면 그 파일을 쓰는 단계도 돈다.
    const own = steps.filter((st) => st.cmd.includes(f));
    own.forEach((st) => names.add(st.name));
    if (own.length) continue;
    if (!hit.length) unknown.push(f);
  }
  if (unknown.length) BROWSER_APP.forEach((x) => names.add(x)); // 모르는 파일이 바뀌면 연기 검사만 돈다
  return { names: [...names], files, unknown };
}
if (flag("--changed")) {
  const c = changedSteps();
  console.log(`변경 ${c.files.length}개 파일 기준`);
  if (c.unknown.length) console.log(`매핑에 없는 파일(연기 검사만 추가, scripts/test.ts의 MAP 확인): ${c.unknown.join(", ")}`);
  if (!c.names.length) { console.log("실행할 단계가 없습니다(문서만 바뀜). 푸시 전에는 bun run test로 전체 게이트를 돌립니다."); process.exit(0); }
  only.push(...c.names.map((n) => "\u0000" + n)); // 정확히 일치하는 이름만
  console.log("단계: " + c.names.join(", "));
  if (flag("--dry-run")) process.exit(0); // 어떤 단계가 도는지만 본다
}
const sel = only.length ? selectSteps(steps.map((s) => s.name), only) : null;
if (sel) for (const m of sel.missing) console.error(`맞는 단계가 없음: ${m.ask}` + (m.similar.length ? `  비슷한 이름: ${m.similar.join(", ")}  (여럿이면 --only '${m.ask}*')` : "  --list로 확인"));
const picked = steps.filter((s) => (sel ? sel.picked.includes(s.name) : !s.slow || flag("--slow")));
if (!picked.length) { console.error("맞는 단계가 없음. --list로 확인"); process.exit(2); }
if (sel) console.log("선택: " + picked.map((s) => s.name).join(", "));
if (picked.some((s) => s.cmd[0] === "node") && (!PW || !CHROME)) { console.error("playwright-core 또는 headless shell을 찾지 못함"); process.exit(2); }

// 프로세스 그룹 전체를 종료한다. 단계가 띄운 서버가 남아 출력 파이프를 붙들면 러너가 잠금을 쥔 채 멈추기 때문이다.
// 단계와 서버는 detached(새 세션, 그룹 리더)로 띄워 -pid로 자손까지 한 번에 보낸다. 리더가 먼저 죽어도 그룹은 남아 있어 신호가 간다.
const killTree = (pid: number) => { try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch {} } };
let running = 0; // 지금 도는 단계의 pid(종료 신호 때 같이 정리)
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
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { if (running) killTree(running); for (const stop of servers.values()) stop(); release(); process.exit(130); });
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
let current = "시작";
const heldAt = Date.now();
// 잠금을 오래 쥐고 있으면 10분마다 알린다(멈춘 러너를 다른 팀원이 알아채도록).
setInterval(() => console.log(`[잠금 ${Math.round((Date.now() - heldAt) / 60000)}분째 보유 중, 현재 단계 ${current}, pid ${process.pid}]`), 600_000).unref();

// 단계 출력은 화면과 /tmp/slidekit-test-logs/<단계>.log에 함께 남긴다(실패 때 다시 볼 수 있게).
const logDir = "/tmp/slidekit-test-logs";
mkdirSync(logDir, { recursive: true });
const STEP_TIMEOUT = Number(process.env.SLIDEKIT_STEP_TIMEOUT ?? 900) * 1000; // 단계 하나의 상한(초). 가장 긴 editor가 약 200초다.
async function run(name: string, cmd: string[], env: Record<string, string> = {}, trace = false) {
  if (cmd[0] === "node") {
    await ensurePw();
    for (const f of globSync(join(logDir, `${name}-trace-*.zip`))) rmSync(f, { force: true }); // 단계당 최근 실행의 트레이스만 둔다
    // 트레이스는 실행 시간을 20% 가까이 늘리므로 평소에는 끄고, 실패한 단계를 한 번 다시 돌릴 때(또는 --trace) 켠다.
    env = { ...env, ...(trace ? { SLIDEKIT_TRACE_DIR: logDir, SLIDEKIT_TRACE_NAME: name } : {}), ...(pwWs ? { SLIDEKIT_PW_WS: pwWs } : {}) };
  }
  const out = createWriteStream(join(logDir, `${name}.log`));
  const p = Bun.spawn(["taskpolicy", "-b", ...cmd], { cwd: root, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe", detached: true }); running = p.pid;
  // 출력 사이가 3초 넘게 벌어지면 "[느림 +N초]" 줄을 넣는다. 고정 sleep과 긴 대기가 어느 검사 앞에 있는지 찾는 용도다.
  let prev = Date.now();
  const pump = async (s: ReadableStream<Uint8Array>, to: NodeJS.WriteStream) => {
    for await (const c of s) {
      const now = Date.now(), gap = (now - prev) / 1000; prev = now;
      if (gap > 3) { const m = `[느림 +${gap.toFixed(1)}초]\n`; to.write(m); out.write(m); }
      to.write(c); out.write(c);
    }
  };
  const pumps = Promise.all([pump(p.stdout, process.stdout), pump(p.stderr, process.stderr)]);
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; const m = `\n[시간 초과 ${STEP_TIMEOUT / 1000}초: 단계와 자식 프로세스를 종료합니다]\n`; process.stdout.write(m); out.write(m); killTree(p.pid); }, STEP_TIMEOUT);
  const code = await p.exited; // 종료 코드는 프로세스 종료로 정한다(출력 파이프가 닫히기를 기다리지 않는다)
  clearTimeout(timer);
  running = 0;
  killTree(p.pid); // 단계가 끝났는데 남은 자식(테스트가 띄운 서버 등)을 정리한다
  await Promise.race([pumps, Bun.sleep(2000)]); // 남은 출력은 2초만 기다린다
  out.end();
  return timedOut ? 124 : code;
}
const waitUp = async (url: string) => {
  for (let i = 0; i < 75; i++) { if (await fetch(`${url}/api/decks`).then((r) => r.ok).catch(() => false)) return; await Bun.sleep(200); }
  throw new Error(`서버가 안 뜸: ${url}`);
};

// 브라우저 서버 하나를 모든 브라우저 단계가 공유한다(scripts/lib/pw.cjs가 SLIDEKIT_PW_WS로 연결). 처음 필요할 때 띄우고 끝에 그룹째 종료한다.
let pwWs = "";
async function ensurePw() {
  if (pwWs || servers.has("pw") || !PW || !CHROME) return;
  const p = Bun.spawn(["taskpolicy", "-b", "node", join(root, "scripts/lib/pw-server.cjs")], { cwd: root, env: { ...process.env, PW, CHROME }, stdout: "pipe", stderr: "inherit", detached: true });
  servers.set("pw", () => killTree(p.pid));
  const reader = p.stdout.getReader();
  const t0 = Date.now();
  let buf = "";
  while (Date.now() - t0 < 30_000) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += new TextDecoder().decode(value);
    const m = buf.match(/WS=(\S+)/);
    if (m) { pwWs = m[1]; reader.releaseLock(); return; }
  }
  console.log("공용 브라우저 서버를 띄우지 못했습니다. 단계마다 직접 launch합니다.");
}
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
    cwd: root, stdout: log, stderr: log, detached: true,
    env: { ...process.env, PORT: "3245", SLIDEKIT_STABLE: "1", SLIDEKIT_READONLY_DECKS: READONLY, SLIDEKIT_DEPLOY_DRY_RUN: "1", SLIDEKIT_KEY_FILE: "/tmp/slidekit-test.key" },
  });
  servers.set(kind, () => killTree(p.pid));
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
const flaky: string[] = []; // 첫 실행은 실패했고 재실행은 통과한 단계
const results: [string, boolean, number][] = [];
try {
  for (const s of picked) {
    current = s.name;
    console.log(`\n== ${s.name}`);
    const t0 = Date.now();
    let before = fingerprint();
    let ok = false;
    try {
      if (s.server) await ensure(s.server);
      ok = (await run(s.name, s.cmd, s.env, flag("--trace"))) === 0;
      // 브라우저 단계가 실패하면(90초 이하일 때) 트레이스를 켜고 한 번 더 돌린다. 재실행이 통과하면 불안정(flaky)으로 표시한다.
      if (!ok && !flag("--trace") && s.cmd[0] === "node" && Date.now() - t0 <= 90_000) {
        console.log(`-- ${s.name}: 실패. 트레이스를 켜고 한 번 다시 실행합니다`);
        ok = (await run(s.name, s.cmd, s.env, true)) === 0;
        if (ok) flaky.push(s.name);
      }
      if (ok) for (const f of globSync(join(logDir, `${s.name}-trace-*.zip`))) rmSync(f, { force: true }); // 성공하면 트레이스는 버린다
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
if (flaky.length) console.log(`\nWARN: 불안정(첫 실행 실패, 재실행 통과): ${flaky.join(", ")}. 로그 ${logDir}/<단계>.log는 재실행 기준이다`);
if (failed.length) {
  console.log(`\nFAIL: ${failed.join(", ")}`);
  for (const n of failed) {
    const tr = globSync(join(logDir, `${n}-trace-*.zip`)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs).slice(0, 2);
    for (const f of tr) console.log(`  트레이스: node ${PW}/cli.js show-trace ${f}`);
  }
  for (const n of failed) console.log(`  다시 실행: bun run test --only ${n}   로그: ${logDir}/${n}.log` + (n === "export" || n === "tokens" ? "   서버 로그: /tmp/sk-eng-srv.log" : ""));
} else console.log("\n전체 통과");
process.exit(failed.length ? 1 : 0);
