// 앱 서버(3210)와 채널을 띄워 핸드셰이크, 알림, reply, 파일 감시를 확인한다.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, readFileSync, readdirSync, rmSync, utimesSync } from "node:fs";
import { findChrome } from "../engine/chrome";
import { join } from "node:path";

const assert = (c: unknown, m = "assert") => { if (!c) throw new Error(m); };
const root = join(import.meta.dir, "..");
const port = process.env.TEST_PORT ?? "3210";
const url = `http://127.0.0.1:${port}`;
const deck = readdirSync(join(root, "decks")).find((d) => existsSync(join(root, "decks", d, "index.html")))!;
const commentsFile = join(root, "decks", deck, "comments.json");
const had = existsSync(commentsFile);

let client: Client | undefined; // 실패해도 finally에서 닫는다(채널 자식 프로세스가 남아 러너가 멈추지 않게)
const app = Bun.spawn(["bun", "run", join(root, "app/server.ts")], { env: { ...process.env, PORT: port, SLIDEKIT_KEY_FILE: "/tmp/slidekit-chan-test.key" }, stdout: "ignore", stderr: "inherit" });
try {
  for (let i = 0; i < 50 && !(await fetch(`${url}/api/decks`).then((r) => r.ok).catch(() => false)); i++) await Bun.sleep(200);

  client = new Client({ name: "test", version: "0" });
  const got: any[] = [];
  client.fallbackNotificationHandler = async (n) => { got.push(n); };
  await client.connect(new StdioClientTransport({ command: "bun", args: [join(import.meta.dir, "index.ts")], env: { ...process.env as any, SLIDEKIT_URL: url } }));

  const caps = client.getServerCapabilities() as any;
  assert(caps.experimental["claude/channel"], "channel capability");
  const names = (await client.listTools()).tools.map((t) => t.name).sort().join();
  assert(names === "ack,get_pending,reply,slidekit_edit", names);
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
  // ack: 작업 시작이 앱에 ackAt으로 반영된다(reply 전에 호출)
  await client.callTool({ name: "ack", arguments: { id } });
  assert(!!((await (await fetch(`${url}/api/comments?deck=${deck}`)).json()) as any[]).find((c) => c.id === id)?.ackAt, "ackAt set after ack");
  await client.callTool({ name: "reply", arguments: { id, text: "완료" } });
  const list = await (await fetch(`${url}/api/comments?deck=${deck}`)).json() as any[];
  assert(list.find((c) => c.id === id)?.status === "done", "done");
  // 보류와 묶음: hold로 쓴 코멘트는 보내지 않고 get_pending에도 안 나오며, send-all이 알림 하나로 묶어 보낸다
  const mk = async (text: string, hold: boolean) => ((await (await fetch(`${url}/api/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deck, slide: 1, path: "", excerpt: "", text, hold }) })).json()) as any).id as string;
  const h1 = await mk("묶음 첫째", true), h2 = await mk("묶음 둘째", true);
  await Bun.sleep(600);
  assert(!got.some((g) => JSON.stringify(g).includes("묶음 첫째")), "held comment is not pushed");
  const pend2 = JSON.parse(((await client.callTool({ name: "get_pending", arguments: {} })) as any).content[0].text);
  assert(!pend2.some((c: any) => c.id === h1 || c.id === h2), "held comments are not in get_pending");
  const sent = (await (await fetch(`${url}/api/comments/send-all`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deck }) })).json()) as any;
  assert(sent.count === 2, `send-all count ${JSON.stringify(sent)}`);
  await Bun.sleep(800);
  const batch = got.filter((g) => g.method === "notifications/claude/channel" && g.params.meta?.kind === "batch");
  assert(batch.length === 1 && batch[0].params.meta.count === "2" && batch[0].params.meta.comment_ids === `${h1},${h2}`, JSON.stringify(batch));
  assert(batch[0].params.content.includes("묶음 첫째") && batch[0].params.content.includes("묶음 둘째") && batch[0].params.content.indexOf("묶음 첫째") < batch[0].params.content.indexOf("묶음 둘째"), "batch lists comments in order");
  const after = (await (await fetch(`${url}/api/comments?deck=${deck}`)).json()) as any[];
  assert(after.filter((c) => c.id === h1 || c.id === h2).every((c) => !c.held && !!c.deliveredAt), "batch marks delivered and clears hold");
  assert(((await (await fetch(`${url}/api/comments/send-all`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deck }) })).json()) as any).count === 0, "second send-all sends nothing");
  // 상한: 보류가 12개여도 한 번에 10개까지만 가고(알림 하나), 나머지는 다시 누르면 간다
  const many: string[] = [];
  for (let i = 0; i < 12; i++) many.push(await mk(`상한 ${String(i).padStart(2, "0")}`, true));
  const sendAll = async () => (await (await fetch(`${url}/api/comments/send-all`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deck }) })).json()) as any;
  const batchesBefore = got.filter((g) => g.params?.meta?.kind === "batch").length;
  const s1 = await sendAll();
  assert(s1.count === 10 && s1.remaining === 2, `cap ${JSON.stringify(s1)}`);
  await Bun.sleep(800);
  const nb = got.filter((g) => g.params?.meta?.kind === "batch");
  assert(nb.length === batchesBefore + 1 && nb.at(-1).params.meta.count === "10", "exactly one batch notification of 10");
  const afterCap = (await (await fetch(`${url}/api/comments?deck=${deck}`)).json()) as any[];
  assert(afterCap.filter((c) => many.includes(c.id) && c.held).length === 2, "the 2 over the cap stay held");
  const s2 = await sendAll();
  assert(s2.count === 2 && s2.remaining === 0, `second ${JSON.stringify(s2)}`);
  // 영역 코멘트: Chrome이 있으면 이미지가 만들어진 뒤 알림 meta에 이미지 경로가 실리고(없으면 이미지 없이 region과 overlap만), 지우면 파일도 지워진다
  const regionId = ((await (await fetch(`${url}/api/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deck, slide: 1, path: "", excerpt: "", text: "영역 알림 시험", region: { x: 0.1, y: 0.1, w: 0.3, h: 0.2 }, overlap: ["h1"], step: 1 }) })).json()) as any).id as string;
  for (let i = 0; i < 100 && !got.some((g) => g.params?.meta?.comment_id === regionId); i++) await Bun.sleep(100);
  const rn = got.find((g) => g.params?.meta?.comment_id === regionId);
  assert(!!rn, "region comment notification arrives");
  assert(rn.params.content.includes('"region":{"x":0.1,"y":0.1,"w":0.3,"h":0.2}') && rn.params.content.includes('"overlap":["h1"]') && rn.params.content.includes('"step":1'), rn.params.content);
  const imgRel = `decks/${deck}/.comments/${regionId}.png`;
  if (findChrome()) {
    assert(rn.params.meta.image === imgRel && rn.params.content.includes('"imageState":"ready"'), JSON.stringify(rn.params));
    const png = readFileSync(join(root, imgRel));
    assert(png[0] === 0x89 && png[1] === 0x50 && png.length > 100 && png.length < 2 * 1024 * 1024, "png file created");
  } else assert(!rn.params.meta.image && /"imageState":"(failed|none)"/.test(rn.params.content), "fallback without image");
  await fetch(`${url}/api/comments/${regionId}/delete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deck }) });
  assert(!existsSync(join(root, imgRel)), "deleting the comment removes the image");
  try { rmSync(join(root, "decks", deck, ".comments"), { recursive: false }); } catch { /* 비어 있지 않거나 없다 */ }
  // 삭제와 되돌리기: restore는 서버가 보관한 코멘트만 되살린다(없는 id는 404)
  const delPost = (path: string, body: unknown) => fetch(`${url}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const before = ((await (await fetch(`${url}/api/comments?deck=${deck}`)).json()) as any[]).length;
  assert((await delPost(`/api/comments/${id}/delete`, { deck })).ok, "delete ok");
  assert(((await (await fetch(`${url}/api/comments?deck=${deck}`)).json()) as any[]).length === before - 1, "deleted");
  assert((await delPost(`/api/comments/nope1/restore`, { deck })).status === 404, "restore unknown 404");
  assert((await delPost(`/api/comments/${id}/restore`, { deck })).ok, "restore ok");
  const restored = ((await (await fetch(`${url}/api/comments?deck=${deck}`)).json()) as any[]).find((c) => c.id === id);
  assert(restored?.trusted === true && restored?.status === "done", "restored comment keeps trust and state");
  assert((await delPost(`/api/comments/${id}/restore`, { deck })).status === 404, "restore only once");
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
  await client?.close().catch(() => {});
  app.kill();
  if (!had) rmSync(commentsFile, { force: true });
}
