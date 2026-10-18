// 번들 HTML에서 덱이 쓰는 외부 호스트와 CSP가 막을 것을 뽑는다(spec/WORKER-CSP.md 4절). deploy.ts와 csp-check.ts가 쓴다. 의존성 없음.
import { MAX_HOSTS, isHost } from "./worker/src/csp";

export type HostScan = {
  hosts: string[]; // 정책에 넣을 https 호스트(유효하고 중복 없고 MAX_HOSTS 이하)
  skipped: string[]; // 못 넣은 것과 이유("http://x", "x.y(형식)", "초과")
  blocked: string[]; // CSP가 막는 사용(예: "fetch", "iframe", "form action")
};

const RES_TAG = /<(?:link|img|video|audio|source|track|script|embed|input|image|use)\b[^>]*>/gi;
const ATTR = /\b(?:src|href|poster|data|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const SRCSET = /\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const CSS_URL = /url\(\s*["']?\s*((?:https?:)?\/\/[^)"'\s]+)/gi;
const CSS_IMPORT = /@import\s+(?:url\(\s*)?["']?\s*((?:https?:)?\/\/[^)"';\s]+)/gi;
// 덱 스크립트가 밖으로 보낼 수 있는 길. 엔진은 이 중 아무것도 쓰지 않는다(engine/slidekit.js가 시험에서 이 목록과 겹치지 않는지 본다).
const SCRIPT_USES: [string, RegExp][] = [
  ["fetch", /\bfetch\s*\(/], ["XMLHttpRequest", /\bXMLHttpRequest\b/], ["WebSocket", /\bWebSocket\b/], ["EventSource", /\bEventSource\b/],
  ["sendBeacon", /\bsendBeacon\b/], ["Worker", /\bnew\s+(?:Shared)?Worker\s*\(/], ["importScripts", /\bimportScripts\s*\(/],
];

const inner = (m: RegExpMatchArray) => m[1] ?? m[2] ?? m[3] ?? "";
const parse = (u: string): { scheme: "https" | "http" | "other"; host: string } => {
  const m = u.trim().match(/^(https?:)?\/\/([^/?#\s]+)/i);
  if (!m) return { scheme: "other", host: "" };
  const host = m[2].replace(/^.*@/, "").replace(/:\d+$/, ""); // user@와 :포트는 정책에 넣지 않는다
  return { scheme: (m[1] ?? "https:").toLowerCase() === "http:" ? "http" : "https", host };
};

export function scanHosts(html: string): HostScan {
  const urls: string[] = [];
  for (const tag of html.matchAll(RES_TAG)) {
    for (const a of tag[0].matchAll(ATTR)) urls.push(inner(a));
    for (const a of tag[0].matchAll(SRCSET)) for (const part of (a[1] ?? a[2] ?? "").split(",")) urls.push(part.trim().split(/\s+/)[0]);
  }
  for (const m of html.matchAll(CSS_URL)) urls.push(m[1]);
  for (const m of html.matchAll(CSS_IMPORT)) urls.push(m[1]);
  const hosts: string[] = [], skipped: string[] = [];
  for (const u of urls) {
    if (!/^(https?:)?\/\//i.test(u.trim())) continue; // data:, blob:, 상대 경로는 정책과 무관하다
    const { scheme, host } = parse(u);
    const h = host.toLowerCase();
    if (scheme === "http") { skipped.push(`http://${h}(http는 허용하지 않음)`); continue; }
    if (!isHost(h)) { skipped.push(`${host}(형식)`); continue; }
    if (hosts.includes(h)) continue;
    if (hosts.length >= MAX_HOSTS) { skipped.push(`${h}(${MAX_HOSTS}개 초과)`); continue; }
    hosts.push(h);
  }
  const blocked: string[] = [];
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].filter((m) => !/type=["']application\/json/i.test(m[0].slice(0, m[0].indexOf(">")))).map((m) => m[1]).join("\n");
  for (const [name, re] of SCRIPT_USES) if (re.test(scripts)) blocked.push(name);
  if (/<iframe\b/i.test(html)) blocked.push("iframe");
  if (/<form\b[^>]*\baction\s*=/i.test(html)) blocked.push("form action");
  if (/<object\b|<embed\b/i.test(html)) blocked.push("object/embed");
  return { hosts, skipped: [...new Set(skipped)], blocked };
}
