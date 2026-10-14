// 덱 HTML을 Markdown 개요로 바꾼다. 순수 함수라 서버, CLI, 브라우저가 같이 쓴다(node:fs와 DOM 파서 없음).
// 형식은 spec/SPEC.md의 "텍스트 내보내기"에 있다. 읽기 순서(DOM 순서)로 평탄화하고 data-step도 그 순서를 그대로 쓴다.
// 포함하지 않는 것: script, style, svg, 숨김 요소, footer, 비밀번호와 코멘트와 게시 기록(HTML 밖의 정보다).

type Node = { tag: string; attrs: Record<string, string>; kids: (Node | string)[]; raw?: string };

const VOID = new Set(["br", "img", "hr", "input", "meta", "link", "wbr", "source", "area", "col", "base", "embed", "track", "param"]);
const RAW = new Set(["script", "style"]);
const SKIP = new Set(["script", "style", "svg", "canvas", "video", "audio", "iframe", "noscript", "template", "head", "footer", "object"]);
const BLOCK = new Set(["p", "div", "section", "article", "header", "main", "nav", "aside", "figure", "figcaption", "ul", "ol", "li", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "blockquote", "pre", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "details", "summary", "dl", "dt", "dd", "form", "fieldset", "body", "html"]);

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "...", copy: "(c)" };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});

function attrsOf(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}

/** 관대한 HTML 트리: 닫히지 않은 태그를 견디고, li와 p는 다음 형제가 열리면 닫는다. */
function parse(html: string): Node {
  const root: Node = { tag: "#root", attrs: {}, kids: [] };
  const stack: Node[] = [root];
  const top = () => stack[stack.length - 1];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!doctype[^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;
  let last = 0, m: RegExpExecArray | null;
  const text = (t: string) => { if (t) top().kids.push(decode(t)); };
  while ((m = re.exec(html))) {
    text(html.slice(last, m.index));
    last = re.lastIndex;
    if (m[1]) { // 닫는 태그: 같은 이름이 열려 있을 때만 거기까지 닫는다
      const tag = m[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === tag) { stack.length = i; break; }
    } else if (m[2]) {
      const tag = m[2].toLowerCase();
      const selfClose = /\/\s*$/.test(m[3]);
      const node: Node = { tag, attrs: attrsOf(m[3].replace(/\/\s*$/, "")), kids: [] };
      if ((tag === "li" || tag === "p") && stack.some((n) => n.tag === tag)) { // 암묵적으로 닫는다(li는 같은 목록 안에서만)
        for (let i = stack.length - 1; i > 0; i--) { if (stack[i].tag === "ul" || stack[i].tag === "ol") break; if (stack[i].tag === tag) { stack.length = i; break; } }
      }
      top().kids.push(node);
      if (RAW.has(tag) && !selfClose) {
        const end = new RegExp(`</${tag}\\s*>`, "i").exec(html.slice(last));
        node.raw = html.slice(last, end ? last + end.index : html.length);
        last = end ? last + end.index + end[0].length : html.length;
        re.lastIndex = last;
      } else if (!VOID.has(tag) && !selfClose) stack.push(node);
    }
  }
  text(html.slice(last));
  return root;
}

const isEl = (n: Node | string): n is Node => typeof n !== "string";
const hidden = (n: Node) => "hidden" in n.attrs || n.attrs["aria-hidden"] === "true" || /display\s*:\s*none/i.test(n.attrs.style ?? "") || SKIP.has(n.tag) || "data-notes" in n.attrs;
const plain = (n: Node | string): string => (typeof n === "string" ? n : hidden(n) ? "" : n.kids.map(plain).join(""));
const rawText = (n: Node | string): string => (typeof n === "string" ? n : n.kids.map(rawText).join(""));
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

function find(n: Node, pick: (x: Node) => boolean, out: Node[] = []): Node[] {
  for (const k of n.kids) if (isEl(k)) { if (pick(k)) out.push(k); find(k, pick, out); }
  return out;
}

// ---- 인라인 ----
const esc = (s: string) => s.replace(/([\\`*_\[\]])/g, "\\$1");
function inline(kids: (Node | string)[], skip?: Node): string {
  let out = "", prev: Node | string | undefined;
  for (const k of kids) {
    const before = prev; prev = k;
    if (typeof k === "string") { out += esc(k.replace(/\s+/g, " ")); continue; }
    if (k === skip || hidden(k)) continue;
    if (k.tag === "span" && before && typeof before !== "string" && before.tag === "span" && out && !/\s$/.test(out)) out += " "; // 붙어 있는 span 둘은 칸을 나누는 구조(번호와 글 등)라 한 칸 띄운다
    const t = k.tag, body = () => inline(k.kids, skip);
    if (t === "br") out += "  \n";
    else if (t === "img") out += k.attrs.src ? `![${esc(squash(k.attrs.alt ?? ""))}](${/^data:/i.test(k.attrs.src) ? "inline-image" : k.attrs.src.replace(/ /g, "%20")})` : ""; // data: 이미지는 글에 붙이기엔 너무 길어 자리표시자로
    else if (t === "a") { const b = body().trim(); out += k.attrs.href && b ? `[${b}](${k.attrs.href.replace(/ /g, "%20")})` : b; }
    else if (t === "b" || t === "strong") { const b = body().trim(); out += b ? `**${b}**` : ""; }
    else if (t === "i" || t === "em") { const b = body().trim(); out += b ? `*${b}*` : ""; }
    else if (t === "code" || t === "kbd") { const c = squash(plain(k)); out += c ? "`" + c.replace(/`/g, "'") + "`" : ""; }
    else if (BLOCK.has(t)) out += " " + body() + " ";
    else out += body();
  }
  return out;
}
const tidy = (s: string) => s.replace(/[ \t]+\n/g, (m) => (m.startsWith("  ") ? "  \n" : "\n")).replace(/ {2,}(?!\n)/g, " ").trim();
const lead = (s: string) => s.replace(/^(\s*)([#>+-]|\d+[.)])(\s)/, "$1\\$2$3"); // 줄 맨 앞의 Markdown 기호는 글자로 둔다

// ---- 블록 ----
type Ctx = { skip?: Node };
function blocks(kids: (Node | string)[], cx: Ctx): string[] {
  const out: string[] = [];
  let buf: (Node | string)[] = [];
  const flush = () => { const t = tidy(inline(buf, cx.skip)); buf = []; if (t) out.push(lead(t)); };
  for (const k of kids) {
    if (typeof k === "string" || !(BLOCK.has(k.tag) && !hidden(k))) { if (typeof k === "string" || !hidden(k)) buf.push(k); continue; }
    if (k === cx.skip) continue;
    flush();
    out.push(...block(k, cx));
  }
  flush();
  return out;
}

function block(n: Node, cx: Ctx): string[] {
  const t = n.tag;
  if (/^h[1-6]$/.test(t)) { const h = tidy(inline(n.kids)); return h ? [`${"#".repeat(Math.max(3, Math.min(6, Number(t[1]) + 1)))} ${h}`] : []; } // 슬라이드 제목이 ##이라 본문 제목은 ###부터(h1과 h2는 같은 ###)
  if (t === "ul" || t === "ol") return [list(n, cx, 0)].filter(Boolean);
  if (t === "pre") { const code = rawText(n).replace(/^\n/, "").replace(/\s+$/, ""); const lang = (find(n, (x) => x.tag === "code")[0]?.attrs.class ?? "").match(/language-([\w+-]+)/)?.[1] ?? ""; return code ? ["```" + lang + "\n" + code + "\n```"] : []; }
  if (t === "blockquote") { const inner = blocks(n.kids, cx).join("\n\n"); return inner ? [inner.split("\n").map((l) => (l ? "> " + l : ">")).join("\n")] : []; }
  if (t === "table") return table(n);
  if (t === "hr") return [];
  return blocks(n.kids, cx);
}

function list(n: Node, cx: Ctx, depth: number): string {
  const ordered = n.tag === "ol";
  let i = Number(n.attrs.start) || 1;
  const lines: string[] = [];
  for (const li of n.kids) {
    if (!isEl(li) || li.tag !== "li" || hidden(li)) continue;
    const mark = ordered ? `${i++}. ` : "- ";
    const pad = " ".repeat(mark.length);
    // li 안: 인라인 글은 한 줄, 중첩 목록은 들여쓴다
    const textKids: (Node | string)[] = [], nested: Node[] = [];
    for (const k of li.kids) { if (isEl(k) && (k.tag === "ul" || k.tag === "ol")) nested.push(k); else textKids.push(k); }
    const parts = blocks(textKids, cx);
    const first = (parts.shift() ?? "").split("\n");
    lines.push(mark + first[0], ...first.slice(1).map((l) => pad + l));
    for (const p of parts) lines.push("", ...p.split("\n").map((l) => (l ? pad + l : l)));
    for (const sub of nested) { const s = list(sub, cx, depth + 1); if (s) lines.push(...s.split("\n").map((l) => pad + l)); }
  }
  return lines.join("\n");
}

function table(n: Node): string[] {
  const rows = find(n, (x) => x.tag === "tr" && !hidden(x)).map((tr) => tr.kids.filter((c): c is Node => isEl(c) && (c.tag === "td" || c.tag === "th") && !hidden(c)).map((c) => tidy(inline(c.kids)).replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|")));
  const cols = Math.max(0, ...rows.map((r) => r.length));
  if (!rows.length || !cols) return [];
  const fill = (r: string[]) => `| ${[...r, ...Array(cols - r.length).fill("")].join(" | ")} |`;
  return [[fill(rows[0]), fill(Array(cols).fill("---")), ...rows.slice(1).map(fill)].join("\n")];
}

// ---- 덱 ----
export type OutlineOptions = { notes?: boolean };

export function outline(html: string, opts: OutlineOptions = {}): string {
  const doc = parse(html);
  let meta: { title?: unknown; author?: unknown; date?: unknown } = {};
  const ms = find(doc, (x) => x.tag === "script" && x.attrs.id === "deck-meta")[0];
  try { if (ms?.raw) meta = JSON.parse(ms.raw); } catch { /* 깨진 메타는 제목 없이 */ }
  const htmlTitle = squash(plain(find(doc, (x) => x.tag === "title")[0] ?? ""));
  const str = (v: unknown) => (typeof v === "string" ? squash(v) : "");
  const out: string[] = [`# ${esc(str(meta.title) || htmlTitle || "Untitled deck")}`];
  const info = [["Author", str(meta.author)], ["Date", str(meta.date)]].filter(([, v]) => v).map(([k, v]) => `- ${k}: ${esc(v)}`);
  if (info.length) out.push(info.join("\n"));

  const slides = find(doc, (x) => x.tag === "section" && "data-slide" in x.attrs);
  slides.forEach((s, i) => {
    const heading = find(s, (x) => /^h[1-6]$/.test(x.tag) && !hidden(x) && !!squash(plain(x)))[0];
    const label = squash(s.attrs["data-title"] ?? "");
    const title = label || (heading ? squash(plain(heading)) : "") || `Slide ${i + 1}`;
    const skip = heading && squash(plain(heading)) === title ? heading : undefined; // 제목과 같은 첫 제목은 두 번 쓰지 않는다
    out.push(`## ${i + 1}. ${esc(title)}`);
    out.push(...blocks(s.kids, { skip }));
    if (opts.notes) {
      const notes = find(s, (x) => x.tag === "aside" && "data-notes" in x.attrs).map((a) => rawText(a).replace(/\r/g, "").trim()).filter(Boolean).join("\n\n");
      if (notes) out.push(notes.split("\n").map((l, j) => (j === 0 ? `> Notes: ${l}` : l ? `> ${l}` : ">")).join("\n"));
    }
  });
  return out.join("\n\n") + "\n";
}
