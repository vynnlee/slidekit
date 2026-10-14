// 채널 복원력: 쌓인 코멘트 묶음 전달(BATCH개와 "더 있다" 알림, 오래된 순), get_pending의 전달 처리,
// 앱 서버 재시작 뒤 자동 재연결, 재연결 뒤 중복 전달 없음, 재연결 뒤 새 코멘트 전달. 실행: bun channel/resilience.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { makeTestDeck } = require("../scripts/lib/test-deck.cjs");
const assert = (c: unknown, m = "assert") => { if (!c) throw new Error(m); };
const root = join(import.meta.dir, "..");
const port = process.env.TEST_PORT ?? "3247";
const url = `http://127.0.0.1:${port}`;
const json = { "Content-Type": "application/json" };
const t = makeTestDeck("chan-res");
const spawnApp = () => Bun.spawn(["bun", "run", join(root, "app/server.ts")], { env: { ...process.env, PORT: port, SLIDEKIT_KEY_FILE: "/tmp/slidekit-chan-test.key" }, stdout: "ignore", stderr: "inherit" });
const up = async () => { for (let i = 0; i < 60; i++) { if (await fetch(`${url}/api/decks`).then((r) => r.ok).catch(() => false)) return; await Bun.sleep(200); } throw new Error("서버가 안 뜸"); };
const connected = async () => ((await (await fetch(`${url}/api/channel`)).json()) as any).connected;
const comments = async () => (await (await fetch(`${url}/api/comments?deck=${t.folder}`)).json()) as any[];

let app = spawnApp();
let client: Client | undefined;
try {
  await up();
  // 채널이 없는 동안 코멘트 12개가 쌓인다.
  const ids: string[] = [];
  for (let i = 1; i <= 12; i++) {
    const r = await fetch(`${url}/api/comments`, { method: "POST", headers: json, body: JSON.stringify({ deck: t.folder, slide: 1, path: "h1", excerpt: "x", text: `요청 ${i}` }) });
    ids.push(((await r.json()) as any).id);
    await Bun.sleep(15); // createdAt이 겹치지 않게
  }
  const got: any[] = [];
  client = new Client({ name: "test", version: "0" });
  client.fallbackNotificationHandler = async (n) => { got.push(n); };
  await client.connect(new StdioClientTransport({ command: "bun", args: [join(root, "channel/index.ts")], env: { ...(process.env as any), SLIDEKIT_URL: url } }));
  // 알림 10개와 "더 있다" 알림이 모이면 바로 진행한다(최대 8초).
  for (let i = 0; i < 80 && !(got.filter((g) => g.params?.meta?.comment_id).length >= 10 && got.some((g) => g.params?.meta?.kind === "backlog")); i++) await Bun.sleep(100);
  await Bun.sleep(300); // 상한을 넘겨 더 오는 알림이 없는지 보기 위한 짧은 여유

  const pushedIds = got.filter((g) => g.params?.meta?.comment_id).map((g) => g.params.meta.comment_id);
  assert(pushedIds.length === 10, `묶음 상한 10개: ${pushedIds.length}`);
  assert(JSON.stringify(pushedIds) === JSON.stringify(ids.slice(0, 10)), "오래된 순서로 전달");
  const backlog = got.filter((g) => g.params?.meta?.kind === "backlog");
  assert(backlog.length === 1 && backlog[0].params.meta.count === "2" && /get_pending/.test(backlog[0].params.content), "더 있다 알림 1개");
  let list = await comments();
  assert(list.filter((c) => c.deliveredAt).length === 10, "10개만 전달 표시");

  // get_pending: 12개를 오래된 순으로 주고 가져간 것은 전달 처리
  const pend = JSON.parse(((await client.callTool({ name: "get_pending", arguments: {} })) as any).content[0].text);
  assert(pend.length === 12, `get_pending ${pend.length}`);
  list = await comments();
  assert(list.every((c) => c.deliveredAt), "get_pending이 나머지를 전달 처리");

  // 앱 서버를 죽였다 다시 띄운다: 채널은 살아 있고 자동 재연결, 중복 전달 없음
  const before = got.length;
  app.kill(); await app.exited;
  await Bun.sleep(500); // 채널이 끊김을 알아채고 재연결 루프에 들어갈 시간
  assert((await client.listTools()).tools.length === 3, "서버가 없어도 채널(MCP)은 살아 있다");
  app = spawnApp(); await up();
  let ok = false;
  for (let i = 0; i < 40 && !ok; i++) { ok = await connected().catch(() => false); if (!ok) await Bun.sleep(250); }
  assert(ok, "재시작 뒤 20초 안에 채널이 다시 연결");
  await Bun.sleep(800); // 재연결 직후 따라잡기(backfill)가 중복을 보낸다면 이 안에 온다
  assert(got.length === before, `재연결 뒤 중복 전달 없음(${got.length - before}개 추가)`);

  // 재연결 뒤 새 코멘트는 바로 전달
  const r = await fetch(`${url}/api/comments`, { method: "POST", headers: json, body: JSON.stringify({ deck: t.folder, slide: 2, path: "h2", excerpt: "y", text: "재연결 뒤 코멘트" }) });
  const newId = ((await r.json()) as any).id;
  for (let i = 0; i < 50 && !got.some((g) => g.params?.meta?.comment_id === newId); i++) await Bun.sleep(100);
  assert(got.some((g) => g.params?.meta?.comment_id === newId), "재연결 뒤 새 코멘트가 전달된다");
  console.log("channel resilience ok");
} finally {
  await client?.close().catch(() => {});
  app.kill();
  t.cleanup();
}
