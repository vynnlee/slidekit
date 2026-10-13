// 노트용 작은 마크다운 렌더러: 제목, 목록, 굵게, 기울임, 코드, 링크, 줄바꿈. 원시 HTML은 모두 이스케이프한다.
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(s: string) {
  const codes: string[] = [];
  s = esc(s).replace(/`([^`]+)`/g, (_, c) => `\0${codes.push(c) - 1}\0`);
  s = s
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer" class="underline">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/(^|[^\w])_([^_\s][^_]*)_(?!\w)/g, "$1<em>$2</em>");
  return s.replace(/\0(\d+)\0/g, (_, i) => `<code>${codes[+i]}</code>`);
}

export function markdown(src: string) {
  const out: string[] = [];
  let para: string[] = [], list: { tag: string; items: string[] } | null = null, fence: string[] | null = null;
  const flushPara = () => { if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`); para = []; };
  const flushList = () => { if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`); list = null; };
  for (const line of src.replace(/\r\n?/g, "\n").split("\n")) {
    if (fence) { if (/^\s*```/.test(line)) { out.push(`<pre><code>${esc(fence.join("\n"))}</code></pre>`); fence = null; } else fence.push(line); continue; }
    let m: RegExpMatchArray | null;
    if (/^\s*```/.test(line)) { flushPara(); flushList(); fence = []; }
    else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) { flushPara(); flushList(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); }
    else if ((m = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/))) {
      flushPara();
      const tag = /\d/.test(m[1]) ? "ol" : "ul";
      if (list && list.tag !== tag) flushList();
      (list ??= { tag, items: [] }).items.push(m[2]);
    } else if (!line.trim()) { flushPara(); flushList(); }
    else { flushList(); para.push(line.trim()); }
  }
  if (fence) out.push(`<pre><code>${esc(fence.join("\n"))}</code></pre>`);
  flushPara(); flushList();
  return out.join("");
}
