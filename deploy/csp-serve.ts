// 브라우저 시험용 로컬 서버(deploy/csp-e2e.cjs가 띄운다): 실제 Worker 코드(handle)를 가짜 KV로 127.0.0.1에서 서빙한다. 원격 호출 없음.
//   사용: bun deploy/csp-serve.ts <포트> <이름=번들HTML경로>...   덱 이름마다 meta는 공개 + 번들에서 뽑은 hosts다(deploy.ts와 같은 규칙).
//   GET /<덱>            Worker 응답 그대로(CSP 포함)
//   GET /off/<덱>        같은 HTML을 CSP 없이(대조군: CSP가 없으면 유출이 실제로 일어나는지 보려고)
//   GET|POST /leak?...   유출 수신구: 불린 횟수를 센다. GET /__hits 가 JSON으로 돌려주고 DELETE /__hits 가 0으로 만든다.
import { readFileSync } from "node:fs";
import { scanHosts } from "./hosts";
import { handle, type Env } from "./worker/src/index";

const [port, ...decks] = process.argv.slice(2);
const store: Record<string, string> = {};
for (const d of decks) {
  const [name, path] = d.split("=");
  const html = readFileSync(path, "utf8");
  store[`html:${name}`] = html;
  store[`meta:${name}`] = JSON.stringify({ visibility: "public", hosts: scanHosts(html).hosts });
}
const env: Env = { DECKS: { get: async (k) => store[k] ?? null, put: async () => {}, delete: async () => {} }, COOKIE_SECRET: "csp-serve" };
let hits: string[] = [];
Bun.serve({
  hostname: "127.0.0.1", port: Number(port),
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/leak") { hits.push(`${req.method} ${u.search.slice(0, 40)}`); return new Response("leaked", { headers: { "Access-Control-Allow-Origin": "*" } }); }
    if (u.pathname === "/__hits") { if (req.method === "DELETE") hits = []; return Response.json(hits); }
    if (u.pathname.startsWith("/off/")) {
      const html = store[`html:${u.pathname.slice(5)}`];
      return html ? new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } }) : new Response("no", { status: 404 });
    }
    return handle(req, env);
  },
});
console.log(`READY ${port}`);
