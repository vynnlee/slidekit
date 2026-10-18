// 코멘트 자동 처리 폭주 방지 통합(spec/COMMENT-FLOOD.md): Pause 중에는 전달하지 않고 Resume하면 따라잡으며, 시간당 상한에 닿으면
// 나머지는 Waiting으로 남고 flow 이벤트와 get_pending 안내가 나온다. Pause는 서버를 다시 띄워도 유지된다. 실행: bun channel/flood.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { makeTestDeck } = require("../scripts/lib/test-deck.cjs");
const assert = (c: unknown, m = "assert") => { if (!c) throw new Error(m); };
const root = join(import.meta.dir, "..");
const port = process.env.TEST_PORT ?? "3262";
const url = `http://127.0.0.1:${port}`;
const json = { "Content-Type": "application/json" };
const keyDir = mkdtempSync(join(tmpdir(), "sk-flood-")); // flow.json이 키 파일 옆에 생기므로 이 시험만의 폴더에 둔다
const t = makeTestDeck("chan-flood");
const spawnApp = (hourly: number) => Bun.spawn(["bun", "run", join(root, "app/server.ts")], { env: { ...process.env, PORT: port, SLIDEKIT_KEY_FILE: join(keyDir, "test.key"), SLIDEKIT_COMMENT_HOURLY: String(hourly) }, stdout: "ignore", stderr: "inherit" });
const up = async () => { for (let i = 0; i < 60 && !(await fetch(`${url}/api/decks`).then((r) => r.ok).catch(() => false)); i++) await Bun.sleep(200); };
const flowNow = async () => (await (await fetch(`${url}/api/comments/flow`)).json()) as any;
const setPause = (paused: boolean) => fetch(`${url}/api/comments/flow`, { method: "POST", headers: json, body: JSON.stringify({ paused }) });
const make = async (text: string) => ((await (await fetch(`${url}/api/comments`, { method: "POST", headers: json, body: JSON.stringify({ deck: t.folder, slide: 1, path: "h1", excerpt: "x", text }) })).json()) as any).id as string;
const comment = async (id: string) => ((await (await fetch(`${url}/api/comments?deck=${t.folder}`)).json()) as any[]).find((c) => c.id === id);
const until = async (f: () => unknown, ms = 6000) => { for (let i = 0; i < ms / 100; i++) { if (await f()) return true; await Bun.sleep(100); } return false; };

let app: ReturnType<typeof spawnApp> | undefined, client: Client | undefined;
const abort = new AbortController();
try {
  // 이 기기의 덱 전체에 이미 최근 전달이 있을 수 있으니 기준 사용량을 읽고 그 위에 2개를 허용하는 상한으로 다시 띄운다
  app = spawnApp(60); await up();
  const base = (await flowNow()).used as number;
  app.kill(); await app.exited;
  app = spawnApp(base + 2); await up();

  // flow 이벤트 수집
  const flows: any[] = [];
  (async () => {
    const res = await fetch(`${url}/api/events`, { signal: abort.signal });
    let buf = "";
    for await (const chunk of res.body!.pipeThrough(new TextDecoderStream())) {
      buf += chunk; let i;
      while ((i = buf.indexOf("\n\n")) >= 0) { const b = buf.slice(0, i); buf = buf.slice(i + 2); if (b.includes("event: flow")) flows.push(JSON.parse(b.split("\n").find((l) => l.startsWith("data: "))!.slice(6))); }
    }
  })().catch(() => {});

  const got: any[] = [];
  client = new Client({ name: "test", version: "0" });
  client.fallbackNotificationHandler = async (n) => { got.push(n); };
  await client.connect(new StdioClientTransport({ command: "bun", args: [join(root, "channel/index.ts")], env: { ...(process.env as any), SLIDEKIT_URL: url } }));
  await Bun.sleep(800);
  const sent = () => got.filter((g) => g.method === "notifications/claude/channel" && g.params?.meta?.comment_id).map((g) => g.params.meta.comment_id as string);
  const text = (r: any) => r.content.map((c: any) => c.text).join("\n");

  // 1) Pause 중에는 새 코멘트가 저장만 되고 전달되지 않는다. get_pending은 안내만 준다.
  assert((await setPause(true)).ok, "pause");
  assert((await flowNow()).reason === "user", "reason user");
  const c0 = await make("멈춘 동안의 코멘트");
  await Bun.sleep(1200);
  assert(sent().length === 0 && !(await comment(c0)).deliveredAt, `Pause 중에는 전달되지 않는다: ${sent()}`);
  const pend = text(await client.callTool({ name: "get_pending", arguments: {} }));
  assert(/Pause/.test(pend) && !pend.includes("멈춘 동안의 코멘트"), pend);
  assert(flows.some((f) => f.paused && f.reason === "user"), "flow 이벤트(Pause)");

  // 2) Resume하면 밀린 코멘트가 따라잡힌다. 상한 아래의 새 코멘트는 바로 전달된다.
  assert((await setPause(false)).ok, "resume");
  assert(await until(() => sent().includes(c0)), `Resume 뒤 따라잡기: ${sent()}`);
  assert(!!(await comment(c0)).deliveredAt, "전달됨 표시");
  const c1 = await make("상한 안의 코멘트");
  assert(await until(() => sent().includes(c1)), "상한 아래는 바로 전달");

  // 3) 상한(base+2)에 닿으면 다음 코멘트는 Waiting으로 남고, flow 이벤트가 limit이며, get_pending이 안내만 준다.
  const c2 = await make("상한을 넘는 코멘트");
  await Bun.sleep(1500);
  assert(!sent().includes(c2) && !(await comment(c2)).deliveredAt, `상한을 넘으면 전달하지 않는다: ${sent()}`);
  const f = await flowNow();
  assert(f.reason === "limit" && f.remaining === 0 && f.resetAt, JSON.stringify(f));
  assert(flows.some((x) => x.reason === "limit" && x.resetAt), "flow 이벤트(limit)");
  assert(/상한/.test(text(await client.callTool({ name: "get_pending", arguments: {} }))), "get_pending이 상한 안내");
  assert((await comment(c2)).status === "open" && !(await comment(c2)).resolved, "코멘트는 잃지 않고 저장돼 있다");

  // 4) Pause는 서버를 다시 띄워도 유지된다
  assert((await setPause(true)).ok, "pause again");
  await client.close().catch(() => {}); client = undefined;
  app.kill(); await app.exited;
  app = spawnApp(base + 2); await up();
  assert((await flowNow()).paused === true, "재시작 뒤에도 Pause");
  assert((await setPause(false)).ok, "cleanup resume");

  // 5) 잘못된 입력
  const bad = await fetch(`${url}/api/comments/flow`, { method: "POST", headers: json, body: JSON.stringify({ paused: "yes" }) });
  assert(bad.status === 400, "paused는 불리언");
  console.log("channel flood ok");
} finally {
  abort.abort();
  await client?.close().catch(() => {});
  app?.kill();
  t.cleanup();
  rmSync(keyDir, { recursive: true, force: true });
}
