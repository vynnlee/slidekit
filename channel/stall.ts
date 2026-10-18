// 코멘트 생명주기 1단계 통합(spec/COMMENT-UX.md): Send all과 Send의 정직한 결과, Resend(force 재전달), Cancel과 withdrawn,
// 죽은 세션이 받고 끊은 요청 이어받기(재연결 backfill), 덱이 바뀔 때 앵커 재계산(순서 변경, 삭제, 되돌림). 실행: bun channel/stall.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { slideBodies } from "../app/slide-edit";

const require = createRequire(import.meta.url);
const { makeTestDeck } = require("../scripts/lib/test-deck.cjs");
const assert = (c: unknown, m = "assert") => { if (!c) throw new Error(m); };
const root = join(import.meta.dir, "..");
const port = process.env.TEST_PORT ?? "3263";
const url = `http://127.0.0.1:${port}`;
const json = { "Content-Type": "application/json" };
const keyDir = mkdtempSync(join(tmpdir(), "sk-stall-"));
const t = makeTestDeck("chan-stall");
const app = Bun.spawn(["bun", "run", join(root, "app/server.ts")], { env: { ...process.env, PORT: port, SLIDEKIT_KEY_FILE: join(keyDir, "test.key"), SLIDEKIT_COMMENT_HOURLY: "0" }, stdout: "ignore", stderr: "inherit" });
const post = (path: string, body: unknown = {}) => fetch(`${url}${path}`, { method: "POST", headers: json, body: JSON.stringify({ deck: t.folder, ...(body as object) }) });
const list = async () => (await (await fetch(`${url}/api/comments?deck=${t.folder}`)).json()) as any[];
const get = async (id: string) => (await list()).find((c) => c.id === id);
const make = async (text: string, extra: object = {}) => ((await (await post("/api/comments", { slide: 1, path: "h1", excerpt: "x", text, ...extra })).json()) as any).id as string;
const until = async (f: () => unknown, ms = 6000) => { for (let i = 0; i < ms / 100; i++) { if (await f()) return true; await Bun.sleep(100); } return false; };
const text = (r: any) => r.content.map((c: any) => c.text).join("\n");

const clients: Client[] = [];
async function connect() {
  const got: any[] = [];
  const client = new Client({ name: "test", version: "0" });
  client.fallbackNotificationHandler = async (n) => { got.push(n); };
  await client.connect(new StdioClientTransport({ command: "bun", args: [join(root, "channel/index.ts")], env: { ...(process.env as any), SLIDEKIT_URL: url } }));
  clients.push(client);
  const sentIds = () => got.flatMap((g) => g.method === "notifications/claude/channel" ? [g.params?.meta?.comment_id, ...String(g.params?.meta?.comment_ids ?? "").split(",")].filter(Boolean) : []) as string[];
  return { client, got, sentIds };
}
try {
  for (let i = 0; i < 60 && !(await fetch(`${url}/api/decks`).then((r) => r.ok).catch(() => false)); i++) await Bun.sleep(200);

  // 1) 채널이 없을 때 Send all: 거짓으로 "보냈다"고 하지 않는다
  const h1 = await make("보류 하나", { hold: true }), h2 = await make("보류 둘", { hold: true });
  const none = (await (await post("/api/comments/send-all")).json()) as any;
  assert(none.count === 2 && none.sent === 0 && none.waiting === 2 && none.reason === "disconnected", JSON.stringify(none));
  assert(!(await get(h1)).held && !(await get(h1)).deliveredAt, "보류는 풀렸지만 전달은 안 됐다(Saved)");

  // 2) 채널이 붙으면 밀린 것이 간다. Pause 중 Send는 저장만 하고 이유를 돌려준다.
  const a = await connect();
  assert(await until(() => a.sentIds().includes(h1) && a.sentIds().includes(h2)), `연결하면 따라잡는다: ${a.sentIds()}`);
  assert((await fetch(`${url}/api/comments/flow`, { method: "POST", headers: json, body: JSON.stringify({ paused: true }) })).ok, "pause");
  const h3 = await make("멈춘 동안", { hold: true });
  const paused = (await (await post(`/api/comments/${h3}/send`)).json()) as any;
  assert(paused.sent === false && paused.reason === "paused", JSON.stringify(paused));
  const allPaused = (await (await post("/api/comments/send-all")).json()) as any;
  assert(allPaused.count === 1 && allPaused.sent === 0 && allPaused.reason === "paused", JSON.stringify(allPaused));
  await fetch(`${url}/api/comments/flow`, { method: "POST", headers: json, body: JSON.stringify({ paused: false }) });
  assert(await until(() => a.sentIds().includes(h3)), "Resume하면 밀린 것이 간다");

  // 3) 개별 Send: 보류를 풀고 바로 간다
  const h4 = await make("개별 전송", { hold: true });
  const one = (await (await post(`/api/comments/${h4}/send`)).json()) as any;
  assert(one.sent === true && one.reason === null, JSON.stringify(one));
  assert(await until(() => a.sentIds().includes(h4)), "개별 Send가 전달된다");

  // 4) Resend: 이미 보낸 코멘트도 force로 다시 간다(전달과 시작 기록을 지운다)
  await post(`/api/comments/${h4}/ack`);
  assert(!!(await get(h4)).ackAt, "ack");
  const before = a.sentIds().filter((i) => i === h4).length;
  const re = (await (await post(`/api/comments/${h4}/resend`)).json()) as any;
  assert(re.sent === true, JSON.stringify(re));
  assert(await until(() => a.sentIds().filter((i) => i === h4).length === before + 1), `Resend가 다시 전달된다: ${before} ${a.sentIds().filter((i) => i === h4).length} ${JSON.stringify(re)} ${JSON.stringify(await get(h4))}`);
  assert(!(await get(h4)).ackAt, "Resend가 시작 기록을 지웠다");

  // 5) Cancel: Saved(보류)로 돌아가고, 그 뒤 ack와 reply는 withdrawn(409). 채널 도구 오류에도 이유가 있다.
  assert((await post(`/api/comments/${h4}/cancel`)).ok, "cancel");
  const c4 = await get(h4);
  assert(c4.held === true && !c4.deliveredAt && !c4.ackAt && c4.cancelledAt, JSON.stringify(c4));
  const ackW = await post(`/api/comments/${h4}/ack`);
  assert(ackW.status === 409 && ((await ackW.json()) as any).error === "withdrawn", "ack withdrawn");
  const repW = await post(`/api/comments/${h4}/reply`, { reply: "늦은 답" });
  assert(repW.status === 409 && ((await repW.json()) as any).error === "withdrawn", "reply withdrawn");
  const tool = (await a.client.callTool({ name: "reply", arguments: { id: h4, text: "늦은 답", deck: t.folder } })) as any;
  assert(tool.isError && /withdrawn/.test(text(tool)), text(tool));
  assert((await (await post(`/api/comments/${h4}/cancel`, {})).json()) !== null && (await get(h4)).status === "open", "취소해도 코멘트는 남는다");
  assert((await post(`/api/comments/${h2}/reply`, { reply: "완료" })).ok && (await post(`/api/comments/${h2}/cancel`)).status === 409, "이미 답한 코멘트는 취소할 수 없다");

  // 6) 죽은 세션 이어받기: 전달 기록만 있고 오래된(5분 전) 요청은 새 채널 연결 때 한 번 다시 간다
  const stale = await make("끊긴 세션이 받고 간 요청");
  await post(`/api/comments/${stale}/delivered`);
  const fresh = await make("방금 전달된 요청");
  await post(`/api/comments/${fresh}/delivered`);
  const arr = JSON.parse(readFileSync(t.commentsFile, "utf8"));
  arr.find((c: any) => c.id === stale).deliveredAt = new Date(Date.now() - 5 * 60_000).toISOString();
  writeFileSync(t.commentsFile, JSON.stringify(arr));
  const b = await connect();
  assert(await until(() => b.sentIds().includes(stale)), `새 세션이 멈춘 요청을 이어받는다: ${b.sentIds()}`);
  await Bun.sleep(600);
  assert(!b.sentIds().includes(fresh), "방금 전달된 요청은 다시 보내지 않는다(다른 세션이 일하는 중일 수 있다)");

  // 7) 앵커 재계산: 파일을 직접 고쳐 슬라이드 순서를 바꾸면 따라가고, 지우면 lost, 돌려놓으면 풀린다
  const src0 = readFileSync(t.file, "utf8");
  const bodies = slideBodies(src0);
  assert(bodies.length >= 4, "시험 덱에 슬라이드가 4장 이상");
  const key = (i: number) => (bodies[i].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 40));
  assert(key(1) !== key(2), "두 슬라이드의 글자가 달라야 한다");
  const anchored = await make("앵커 시험", { slide: 3, path: "", excerpt: "" });
  const swap = (arr2: string[]) => { let out = src0, from = 0; for (let i = 0; i < arr2.length; i++) { const at = out.indexOf(bodies[i], from); out = out.slice(0, at) + arr2[i] + out.slice(at + bodies[i].length); from = at + arr2[i].length; } return out; };
  const order = bodies.map((_, i) => i); [order[1], order[2]] = [order[2], order[1]];
  writeFileSync(t.file, swap(order.map((i) => bodies[i])));
  assert(await until(async () => (await get(anchored)).slide === 2), `순서 변경을 따라간다: ${(await get(anchored)).slide}`);
  assert((await get(anchored)).anchor === "ok", "anchor ok");
  // 그 슬라이드 삭제
  const cur = readFileSync(t.file, "utf8");
  const curBodies = slideBodies(cur);
  const at = cur.indexOf(curBodies[1]);
  writeFileSync(t.file, cur.slice(0, at) + cur.slice(at + curBodies[1].length));
  assert(await until(async () => (await get(anchored)).anchor === "lost"), `삭제하면 lost: ${JSON.stringify(await get(anchored))}`);
  assert((await get(anchored)).slideDeleted === true, "slideDeleted 호환 필드");
  // 자동 전달에서 빠진다(Detached)
  const pend = JSON.parse(((await a.client.callTool({ name: "get_pending", arguments: {} })) as any).content[0].text);
  assert(!pend.some((c: any) => c.id === anchored), "Detached 코멘트는 get_pending에 없다");
  // 원래대로 돌려놓으면(실행 취소) 풀린다
  writeFileSync(t.file, swap(order.map((i) => bodies[i])));
  assert(await until(async () => (await get(anchored)).anchor === "ok" && (await get(anchored)).slide === 2), `되돌리면 풀린다: ${JSON.stringify(await get(anchored))}`);
  console.log("channel stall ok");
} finally {
  for (const c of clients) await c.close().catch(() => {});
  app.kill();
  t.cleanup();
  rmSync(keyDir, { recursive: true, force: true });
}
