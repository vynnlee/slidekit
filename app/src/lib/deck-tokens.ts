// 덱 토큰(`--sk-` 변수와 덱 전용 변수)을 head의 `:root{}` 블록에서 읽고 고친다. SPEC 9절.
// 원문 보존: 바뀌는 값 글자 외에는 주석, 다른 규칙, 순서, 공백을 그대로 둔다.
// 입력은 덱 prefix(첫 슬라이드 앞까지)이지만 `<style>`이 있는 어떤 HTML 조각이어도 된다.

type Decl = { name: string; valueStart: number; valueEnd: number };
type Root = { open: number; close: number; decls: Decl[] }; // open: `{` 다음, close: `}` 위치
type StyleBlock = { start: number; end: number; roots: Root[] }; // start, end는 CSS 글자 범위

const blank = (s: string, a: number, b: number) => s.slice(0, a) + " ".repeat(b - a) + s.slice(b);

// CSS 안의 주석과 문자열을 같은 길이의 공백으로 가려 괄호를 안전하게 센다.
function maskCss(css: string) {
  let m = css;
  const re = /\/\*[\s\S]*?(?:\*\/|$)|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g;
  for (const t of css.matchAll(re)) m = blank(m, t.index!, t.index! + t[0].length);
  return m;
}

function declsOf(css: string, masked: string, from: number, to: number): Decl[] {
  const out: Decl[] = [];
  let depth = 0, start = from;
  const flush = (end: number) => {
    const seg = masked.slice(start, end), c = /^\s*(--[\w-]+)\s*:/.exec(seg);
    if (c) {
      let vs = start + c[0].length, ve = end;
      while (vs < ve && /\s/.test(css[vs])) vs++;
      while (ve > vs && /\s/.test(css[ve - 1])) ve--;
      out.push({ name: c[1], valueStart: vs, valueEnd: ve });
    }
  };
  for (let i = from; i < to; i++) {
    const ch = masked[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === ";" && depth === 0) { flush(i); start = i + 1; }
  }
  flush(to);
  return out;
}

function parseStyles(src: string): StyleBlock[] {
  const hidden = src.replace(/<!--[\s\S]*?-->/g, (c) => " ".repeat(c.length));
  const blocks: StyleBlock[] = [];
  for (const m of hidden.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
    const start = m.index! + m[0].indexOf(">") + 1, end = start + m[1].length;
    const css = src.slice(start, end), masked = maskCss(css);
    const roots: Root[] = [];
    // 최상위 `:root {` 만 본다(@media 안은 건드리지 않는다).
    let depth = 0;
    for (let i = 0; i < masked.length; i++) {
      if (masked[i] === "{") {
        if (depth === 0 && /(?:^|[}\s,;])(?:html\s*)?:root\s*$/i.test(masked.slice(Math.max(0, i - 40), i))) {
          let d = 1, j = i + 1;
          while (j < masked.length && d) { if (masked[j] === "{") d++; else if (masked[j] === "}") d--; j++; }
          if (!d) roots.push({ open: start + i + 1, close: start + j - 1, decls: declsOf(src, blank(src, 0, 0), 0, 0) });
        }
        depth++;
      } else if (masked[i] === "}") depth = Math.max(0, depth - 1);
    }
    // decls는 전체 src 좌표로 다시 계산한다(maskCss는 style 조각 기준이라 오프셋을 더한다).
    for (const r of roots) {
      const inner = src.slice(r.open, r.close), mi = maskCss(inner);
      r.decls = declsOf(inner, mi, 0, inner.length).map((d) => ({ name: d.name, valueStart: d.valueStart + r.open, valueEnd: d.valueEnd + r.open }));
    }
    blocks.push({ start, end, roots });
  }
  return blocks;
}

/** 덱이 `:root`에 선언한 변수. 같은 이름이 여러 번이면 마지막 값이 이긴다. */
export function readTokens(prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const b of parseStyles(prefix)) for (const r of b.roots) for (const d of r.decls) out[d.name] = prefix.slice(d.valueStart, d.valueEnd);
  return out;
}

/** 변수 하나를 설정한다. 있으면 그 값 글자만, 없으면 마지막 `:root` 블록 끝에, 블록이 없으면 새 블록을 만든다. */
export function setToken(prefix: string, name: string, value: string): string {
  if (!/^--[\w-]+$/.test(name)) throw new Error(`변수 이름이 올바르지 않다: ${name}`);
  // 문자열과 괄호 밖의 ; 와 { } < /* 는 선언을 깨뜨리므로 거부한다.
  const bare = maskCss(value);
  let depth = 0;
  for (const ch of bare) { if (ch === "(") depth++; else if (ch === ")") depth--; else if (ch === ";" && depth <= 0) depth = -999; }
  if (depth < 0 || depth > 0 || /[{}<]/.test(bare) || /\/\*/.test(value)) throw new Error("값에 ; { } < /* 는 쓸 수 없다");
  const blocks = parseStyles(prefix);
  let hit: Decl | null = null;
  for (const b of blocks) for (const r of b.roots) for (const d of r.decls) if (d.name === name) hit = d;
  if (hit) return prefix.slice(0, hit.valueStart) + value + prefix.slice(hit.valueEnd);
  const roots = blocks.flatMap((b) => b.roots), last = roots.at(-1);
  if (last) {
    const inner = prefix.slice(last.open, last.close), lastDecl = last.decls.at(-1);
    if (inner.includes("\n")) {
      // 마지막 내용 뒤에 새 줄로 넣고, 닫는 `}` 앞의 줄과 들여쓰기는 그대로 둔다.
      const end = last.open + inner.trimEnd().length;
      const hasSemi = !lastDecl || /;/.test(prefix.slice(lastDecl.valueEnd, end));
      const ls = lastDecl ? prefix.lastIndexOf("\n", lastDecl.valueStart) + 1 : prefix.lastIndexOf("\n", last.open) + 1;
      const indent = lastDecl ? /^[ \t]*/.exec(prefix.slice(ls))![0] : /^[ \t]*/.exec(prefix.slice(ls))![0] + "  ";
      return prefix.slice(0, end) + (hasSemi ? "" : ";") + `\n${indent}${name}: ${value};` + prefix.slice(end);
    }
    const end = last.open + inner.trimEnd().length;
    const hasSemi = !lastDecl || /;/.test(prefix.slice(lastDecl.valueEnd, end));
    const gap = end === last.open ? " " : "", tail = end === last.close ? " " : "";
    return prefix.slice(0, end) + (hasSemi ? "" : ";") + `${gap} ${name}: ${value};${tail}`.replace(/^ {2}/, " ") + prefix.slice(end);
  }
  const rule = `:root { ${name}: ${value}; }`;
  const first = blocks[0];
  if (first) {
    const css = prefix.slice(first.start, first.end), nl = css.endsWith("\n") || css.endsWith(" ") ? "" : "\n";
    // 첫 style 블록 끝에 새 규칙을 붙인다(닫는 태그 앞 들여쓰기는 그대로).
    const tail = /[ \t]*$/.exec(css)![0];
    const cut = first.end - tail.length;
    const lead = /\n[ \t]*\S/.exec(css) ? "  " : "";
    return prefix.slice(0, cut) + (css.slice(0, css.length - tail.length).endsWith("\n") ? "" : "\n") + lead + rule + "\n" + tail + prefix.slice(first.end);
  }
  const head = /<\/head\s*>/i.exec(prefix);
  const block = `  <style>\n    ${rule}\n  </style>\n`;
  return head ? prefix.slice(0, head.index) + block + prefix.slice(head.index) : block + prefix;
}
