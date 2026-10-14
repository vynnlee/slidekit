// 노트용 작은 마크다운 렌더러: 제목, 목록, 굵게, 기울임, 코드, 링크, 줄바꿈. 원시 HTML은 모두 이스케이프한다.
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// 아주 긴 한 줄이나 닫히지 않는 [ * 가 정규식을 O(n^2)로 만들지 않게 줄 길이와 각 패턴의 폭을 제한한다.
const MAX_LINE = 2000;

function inline(s: string) {
  if (s.length > MAX_LINE) return esc(s); // 긴 줄은 서식 없이 그대로(이스케이프만) 보인다
  s = s.replace(/[\0-\u0003]/g, ""); // 아래 자리표시자와 겹치는 제어 문자는 입력에서 뺀다
  const codes: string[] = [], links: string[] = [];
  s = esc(s).replace(/`([^`]+)`/g, (_, c) => `\0${codes.push(c) - 1}\0`);
  // 링크의 여는 태그(href 안에 * 나 _ 가 있을 수 있다)는 자리표시자로 빼 두어 아래 서식 치환이 건드리지 못하게 하고, 서식이 끝난 뒤에 되돌린다.
  s = s.replace(/\[([^\]]{1,200})\]\((https?:\/\/[^\s)]{1,500}|mailto:[^\s)]{1,500})\)/g, (_, text, url) => `\u0001${links.push(url) - 1}\u0002${text}\u0003`);
  s = s
    .replace(/\*\*([^*]{1,500})\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\s][^*]{0,500})\*/g, "$1<em>$2</em>")
    .replace(/(^|[^\w])_([^_\s][^_]{0,500})_(?!\w)/g, "$1<em>$2</em>");
  return s
    .replace(/\u0001(\d+)\u0002/g, (_, i) => `<a href="${links[+i]}" target="_blank" rel="noreferrer" class="underline">`)
    .replace(/\u0003/g, "</a>")
    .replace(/\0(\d+)\0/g, (_, i) => `<code>${codes[+i]}</code>`);
}

export function markdown(src: string) {
  src = src.slice(0, 200_000); // 노트 한 장의 상한
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
