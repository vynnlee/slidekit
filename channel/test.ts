// 앱 서버(3210)와 채널을 띄워 핸드셰이크, 알림, reply, 파일 감시를 확인한다.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, readdirSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";

const assert = (c: unknown, m = "assert") => { if (!c) throw new Error(m); };
const root = join(import.meta.dir, "..");
const port = process.env.TEST_PORT ?? "3210";
const url = `http://127.0.0.1:${port}`;
const deck = readdirSync(join(root, "decks")).find((d) => existsSync(join(root, "decks", d, "index.html")))!;
const commentsFile = join(root, "decks", deck, "comments.json");
const had = existsSync(commentsFile);

const app = Bun.spawn(["bun", "run", join(root, "app/server.ts")], { env: { ...process.env, PORT: port }, stdout: "ignore", stderr: "inherit" });
try {
  for (let i = 0; i < 50 && !(await fetch(`${url}/api/decks`).then((r) => r.ok).catch(() => false)); i++) await Bun.sleep(200);

  const client = new Client({ name: "test", version: "0" });
  const got: any[] = [];
  client.fallbackNotificationHandler = async (n) => { got.push(n); };
  await client.connect(new StdioClientTransport({ command: "bun", args: [join(import.meta.dir, "index.ts")], env: { ...process.env as any, SLIDEKIT_URL: url } }));

  const caps = client.getServerCapabilities() as any;
  assert(caps.experimental["claude/channel"], "channel capability");
  const names = (await client.listTools()).tools.map((t) => t.name).sort().join();
  assert(names === "get_pending,reply", names);
  await Bun.sleep(500); // SSE 구독 대기
  assert(((await (await fetch(`${url}/api/channel`)).json()) as any).connected === true, "channel presence true");

  const { id } = await (await fetch(`${url}/api/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deck, slide: 1, path: "h1", excerpt: "x", text: "제목 키워줘" }) })).json() as any;
  await Bun.sleep(500);
  const n = got.find((g) => g.method === "notifications/claude/channel");
  assert(n?.params.meta.comment_id === id && n.params.content.includes("제목 키워줘"), JSON.stringify(got));
  const afterPush = await (await fetch(`${url}/api/comments?deck=${deck}`)).json() as any[];
  assert(!!afterPush.find((c) => c.id === id)?.deliveredAt, "deliveredAt set after push");

  const pend = JSON.parse(((await client.callTool({ name: "get_pending", arguments: {} })) as any).content[0].text);
  assert(pend.some((c: any) => c.id === id), "pending");
  await client.callTool({ name: "reply", arguments: { id, text: "완료" } });
  const list = await (await fetch(`${url}/api/comments?deck=${deck}`)).json() as any[];
  assert(list.find((c) => c.id === id)?.status === "done", "done");
  // 해결 표시와 되돌리기
  const post = (path: string, body: unknown) => fetch(`${url}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert((await post(`/api/comments/${id}/resolve`, { deck, resolved: true })).ok, "resolve ok");
  assert(((await (await fetch(`${url}/api/comments?deck=${deck}`)).json()) as any[]).find((c) => c.id === id)?.resolved === true, "resolved");
  assert((await post(`/api/comments/${id}/resolve`, { deck, resolved: "yes" })).status === 400, "resolve validates");
  await post(`/api/comments/${id}/resolve`, { deck, resolved: false });
  assert(((await (await fetch(`${url}/api/comments?deck=${deck}`)).json()) as any[]).find((c) => c.id === id)?.resolved === undefined, "unresolved");

  const sse = await fetch(`${url}/api/events`);
  const reader = sse.body!.pipeThrough(new TextDecoderStream()).getReader();
  utimesSync(join(root, "decks", deck, "index.html"), new Date(), new Date());
  const { value } = await Promise.race([reader.read(), Bun.sleep(3000).then(() => ({ value: "timeout" }))]);
  let text = value as string;
  if (!text.includes("deck-changed")) text += (await Promise.race([reader.read(), Bun.sleep(3000).then(() => ({ value: "" }))])).value;
  assert(text.includes("deck-changed"), `sse: ${text}`);
  await client.close();
  await Bun.sleep(800);
  assert(((await (await fetch(`${url}/api/channel`)).json()) as any).connected === false, "channel presence false after close");
  console.log("channel test ok");
} finally {
  app.kill();
  if (!had) rmSync(commentsFile, { force: true });
}
