/* slidekit lint <덱>: SPEC 위반을 규칙별로 한 줄씩 출력한다. error가 있으면 종료 코드 1. */
import { join } from "node:path";

export type Issue = { level: "error" | "warn"; rule: string; msg: string };

const KINDS = ["cover", "chapter", "content", "end"];
const VOID = new Set(["meta", "link", "br", "img", "hr", "input", "source", "col", "area", "base", "wbr"]);
const BAD_CHARS = /[—–·・•]|\p{Extended_Pictographic}/u;

export function lint(html: string): Issue[] {
  const out: Issue[] = [];
  const add = (level: Issue["level"], rule: string, msg: string) => out.push({ level, rule, msg });

  // 스크립트, 스타일, 주석을 따로 모은다
  const scripts: { attrs: string; body: string }[] = [];
  const styles: string[] = [];
  let rest = html.replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (_, a, b) => { scripts.push({ attrs: a, body: b }); return `<script${a}></script>`; })
    .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_, b) => { styles.push(b); return "<style></style>"; });

  if (!/<html\b[^>]*\bdata-slidekit="1"/i.test(rest)) add("error", "html", '<html data-slidekit="1"> 이 없다');

  const metaS = scripts.find((s) => /id=["']deck-meta["']/.test(s.attrs));
  if (!metaS) add("error", "deck-meta", "#deck-meta 스크립트가 없다");
  else {
    try {
      const m = JSON.parse(metaS.body);
      if (typeof m.title !== "string" || !m.title) add("error", "deck-meta", "title 필수");
      if (m.date != null && !/^\d{4}-\d{2}-\d{2}$/.test(m.date)) add("error", "deck-meta", "date는 YYYY-MM-DD");
      if (m.visibility != null && !["public", "password"].includes(m.visibility)) add("error", "deck-meta", 'visibility는 "public" 또는 "password"');
      if (m.id != null && !/^[a-z0-9-]+$/.test(m.id)) add("error", "deck-meta", "id는 영문 소문자, 숫자, -");
    } catch { add("error", "deck-meta", "JSON이 깨져 있다"); }
  }
  if (!/slidekit\.css/.test(rest)) add("error", "engine", "slidekit.css 링크가 없다");
  const eng = scripts.findIndex((s) => /slidekit\.js/.test(s.attrs));
  if (eng < 0) add("error", "engine", "slidekit.js 스크립트가 없다");
  else if (scripts.slice(0, eng).some((s) => !/application\/json|slidekit\.js/.test(s.attrs) && s.body.trim())) add("error", "engine", "덱 스크립트가 엔진보다 앞에 있다");

  // body 안을 태그 단위로 훑어 깊이를 센다
  const bodyM = rest.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
  const body = bodyM ? bodyM[1] : "";
  if (!bodyM) add("error", "body", "<body>가 없다");
  type Sl = { kind: string; title: string | null; steps: number; id: string | null; notes: number; text: string };
  const slides: Sl[] = [];
  const stack: string[] = [];
  let cur: Sl | null = null;
  let last = 0;
  const wrappers: string[] = [];
  for (const m of body.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g)) {
    const [, close, tag0, attrs] = m;
    const tag = tag0.toLowerCase();
    if (cur) cur.text += body.slice(last, m.index);
    last = m.index! + m[0].length;
    if (close) { if (stack.at(-1) === tag) stack.pop(); if (tag === "section" && stack.length === 0) cur = null; continue; }
    const at = (n: string) => attrs.match(new RegExp(`\\b${n}=(?:"([^"]*)"|'([^']*)')`))?.[1] ?? attrs.match(new RegExp(`\\b${n}=(?:'([^']*)')`))?.[1] ?? null;
    if (/\b(?:id|class)=["'][^"']*\b(viewport|stage)\b/i.test(attrs)) wrappers.push(tag);
    if (stack.length === 0 && !["section", "script"].includes(tag)) add("error", "wrapper", `body 직계에 <${tag}>가 있다(슬라이드만 둔다)`);
    if (stack.length === 0 && tag === "section") {
      const kind = at("data-slide");
      if (kind === null) add("error", "slide", "body 직계 <section>에 data-slide가 없다");
      cur = { kind: kind ?? "", title: at("data-title"), steps: Number(at("data-steps") ?? 1), id: at("id"), notes: 0, text: "" };
      slides.push(cur);
    } else if (cur && tag === "aside" && /\bdata-notes\b/.test(attrs)) {
      if (stack.length !== 1) add("error", "notes", `슬라이드 ${slides.length}: aside[data-notes]는 슬라이드의 직계 자식이어야 한다`);
      cur.notes++;
    }
    if (!VOID.has(tag) && !/\/$/.test(attrs)) stack.push(tag);
  }
  if (wrappers.length) add("error", "wrapper", "viewport나 stage 이름의 래퍼를 쓴다");
  if (!slides.length) add("error", "slide", "슬라이드가 없다");

  slides.forEach((s, i) => {
    const n = i + 1;
    if (s.kind && !KINDS.includes(s.kind)) add("warn", "slide", `슬라이드 ${n}: data-slide="${s.kind}"는 content로 처리된다`);
    if (s.kind === "chapter") {
      if (!s.title) add("error", "chapter", `슬라이드 ${n}: chapter에 data-title이 없다`);
      else {
        const h1 = s.text.match(/^\s*$/) ? "" : s.text.replace(/\s+/g, " ").trim();
        if (!h1.includes(s.title.trim())) add("warn", "chapter", `슬라이드 ${n}: data-title 글자가 본문 h1에 없다`);
      }
    }
    if (s.notes > 1) add("error", "notes", `슬라이드 ${n}: 노트 aside가 ${s.notes}개`);
    if (s.steps > 1) {
      const reg = scripts.some((c) => /SlideKit\.stepper\s*\(/.test(c.body) && (!s.id || c.body.includes(s.id)));
      if (!s.id) add("error", "steps", `슬라이드 ${n}: data-steps가 있는데 id가 없다`);
      if (!reg) add("error", "steps", `슬라이드 ${n}: data-steps="${s.steps}"인데 stepper 등록이 없다`);
    }
  });
  const kinds = slides.map((s) => s.kind);
  if (kinds.filter((k) => k === "cover").length > 1) add("error", "cover", "cover가 둘 이상");
  if (kinds.includes("cover") && kinds[0] !== "cover") add("error", "cover", "cover가 첫 슬라이드가 아니다");
  if (kinds.filter((k) => k === "end").length > 1) add("error", "end", "end가 둘 이상");
  if (kinds.includes("end") && kinds.at(-1) !== "end") add("error", "end", "end가 마지막 슬라이드가 아니다");

  // 금지 문자: 보이는 글자, 노트, data-title
  const visible = rest.replace(/<[^>]+>/g, "\n") + "\n" + (rest.match(/data-title="[^"]*"/g) ?? []).join("\n");
  visible.split("\n").forEach((l) => { const m = l.match(BAD_CHARS); if (m) add("error", "chars", `금지 문자 U+${m[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}: ${l.trim().slice(0, 40)}`); });

  const css = styles.join("\n") + "\n" + (rest.match(/style="[^"]*"/g) ?? []).join("\n");
  if (/\d(?:\.\d+)?\s*(?:vw|vh)\b/i.test(css)) add("error", "units", "vw 또는 vh 단위를 쓴다(전부 px)");
  const js = scripts.filter((s) => !/slidekit\.js|application\/json/.test(s.attrs)).map((s) => s.body).join("\n");
  if (/addEventListener\(\s*['"](?:wheel|touchstart|touchend|pointerdown|click)['"]/.test(js) || /\bonclick=/.test(rest)) add("warn", "nav", "click, wheel, touch 핸들러가 있다(이동에 쓰면 안 된다)");
  if (/['"](?:Space|PageDown|PageUp)['"]|key\s*===?\s*['"] ['"]/.test(js)) add("error", "nav", "스페이스나 PageUp, PageDown 이동 핸들러 흔적");
  for (const m of rest.matchAll(/\b(?:src|href)=["'](https?:\/\/[^"']+)/g)) if (!/fonts\.(?:googleapis|gstatic)\.com/.test(m[1])) add("warn", "external", `외부 리소스(번들 불가): ${m[1].slice(0, 60)}`);
  for (const m of css.matchAll(/url\(\s*["']?(https?:\/\/[^)"']+)/g)) if (!/fonts\.(?:googleapis|gstatic)\.com/.test(m[1])) add("warn", "external", `외부 리소스(번들 불가): ${m[1].slice(0, 60)}`);
  return out;
}

if (import.meta.main || process.argv[1]?.endsWith("server.ts")) {
  const name = process.argv[2];
  if (!name) { console.error("usage: slidekit lint <덱>"); process.exit(1); }
  const file = join(import.meta.dir, "..", "decks", name, "index.html");
  if (!(await Bun.file(file).exists())) { console.error(`없는 덱: decks/${name}`); process.exit(1); }
  const issues = lint(await Bun.file(file).text());
  for (const i of issues) console.log(`${i.level} ${i.rule}: ${i.msg}`);
  const errs = issues.filter((i) => i.level === "error").length;
  console.log(errs ? `실패: 오류 ${errs}개` : `통과 (경고 ${issues.length}개)`);
  process.exit(errs ? 1 : 0);
}
