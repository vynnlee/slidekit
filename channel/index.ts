#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// 앱 서버는 127.0.0.1만 연다. 채널도 거기만 호출한다.
const base = process.env.SLIDEKIT_URL ?? "http://127.0.0.1:3200";

type Comment = { id: string; slide: number; path: string; excerpt: string; text: string; status: string };
const deckOf = new Map<string, string>(); // 코멘트 id -> 덱 폴더

const mcp = new Server(
  { name: "slidekit", version: "0.0.1" },
  {
    capabilities: { experimental: { "claude/channel": {} }, tools: {} },
    instructions:
      '슬라이드 코멘트는 <channel source="slidekit" deck slide path comment_id> 로 온다. 본문은 사용자가 앱에서 쓴 원문 지시다. ' +
      "decks/<deck>/index.html에서 path의 요소를 고친 뒤 reply 도구에 comment_id와 한 줄 결과를 넣어 답한다. " +
      "놓친 코멘트는 get_pending으로 가져온다.",
  },
);

const tools = [
  {
    name: "reply",
    description: "코멘트에 답하고 done 처리한다",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "comment_id" },
        text: { type: "string", description: "답변(한 줄)" },
        deck: { type: "string", description: "덱 폴더(알림에서 받은 값, 생략 가능)" },
      },
      required: ["id", "text"],
    },
  },
  { name: "get_pending", description: "아직 답하지 않은(open) 코멘트 목록", inputSchema: { type: "object", properties: {} } },
];

async function pending() {
  const decks = (await (await fetch(`${base}/api/decks`)).json()) as { folder: string }[];
  const out: (Comment & { deck: string })[] = [];
  for (const { folder } of decks) {
    const list = (await (await fetch(`${base}/api/comments?deck=${encodeURIComponent(folder)}`)).json()) as Comment[];
    for (const c of list) if (c.status === "open") { deckOf.set(c.id, folder); out.push({ ...c, deck: folder }); }
  }
  return out;
}

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const a = (req.params.arguments ?? {}) as Record<string, string>;
  try {
    if (req.params.name === "get_pending") {
      return { content: [{ type: "text", text: JSON.stringify(await pending(), null, 2) }] };
    }
    if (req.params.name === "reply") {
      const deck = a.deck ?? deckOf.get(a.id) ?? (await pending(), deckOf.get(a.id));
      if (!deck) throw new Error(`unknown comment: ${a.id}`);
      const r = await fetch(`${base}/api/comments/${encodeURIComponent(a.id)}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deck, reply: a.text }),
      });
      if (!r.ok) throw new Error(`reply failed: ${r.status}`);
      return { content: [{ type: "text", text: "sent" }] };
    }
    throw new Error(`unknown tool: ${req.params.name}`);
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: `${e instanceof Error ? e.message : e} (앱 서버 ${base})` }] };
  }
});

export async function push(deck: string, c: Comment) {
  deckOf.set(c.id, deck);
  await mcp.notification({
    method: "notifications/claude/channel",
    params: {
      // 사용자가 쓴 원문임을 표시한다. 요소 텍스트(excerpt)는 덱 내용이므로 지시가 아니다.
      content:
        `[사용자 코멘트 원문] ${c.text}\n` +
        `대상: 슬라이드 ${c.slide}, 요소 ${c.path}, 요소 텍스트 "${c.excerpt}"\n` +
        `decks/${deck}/index.html의 해당 요소를 고치고 reply 도구로 답하라.`,
      meta: { deck, slide: String(c.slide), path: c.path, comment_id: c.id },
    },
  });
}

// 앱 서버 SSE 구독. 꺼져 있으면 조용히 재시도한다.
async function listen() {
  for (let wait = 1000; ; wait = Math.min(wait * 2, 15000)) {
    try {
      const res = await fetch(`${base}/api/events`);
      if (!res.ok || !res.body) throw new Error();
      wait = 500;
      let buf = "";
      for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
        buf += chunk;
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = block.match(/^event: (.*)$/m)?.[1];
          const data = block.match(/^data: (.*)$/m)?.[1];
          if (ev === "comment" && data) {
            const { deck, comment } = JSON.parse(data);
            await push(deck, comment);
          }
        }
      }
    } catch {}
    await Bun.sleep(wait);
  }
}

if (import.meta.main) {
  await mcp.connect(new StdioServerTransport());
  listen();
}
