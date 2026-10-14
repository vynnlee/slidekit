/* slidekit lint <덱>: SPEC 위반을 규칙별로 한 줄씩 출력한다. error가 있으면 종료 코드 1. */
import { join } from "node:path";
import { LAYOUT_IDS } from "./layouts";
import { validateMeta } from "./deck-meta";
import { localImageRefs } from "./publish-record";

export type Issue = { level: "error" | "warn"; rule: string; msg: string };

const KINDS = ["cover", "chapter", "content", "end"];
const VOID = new Set(["p", "li", "dt", "dd", "option", /* 닫는 태그 생략 가능 */ "meta", "link", "br", "img", "hr", "input", "source", "col", "area", "base", "wbr"]);
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

  if (!/<html\b[^>]*\bdata-slidekit="1"/i.test(rest)) add("error", "html", '<html> 태그에 data-slidekit="1"을 붙인다');

  const metaS = scripts.find((s) => /id=["']deck-meta["']/.test(s.attrs));
  if (!metaS) add("error", "deck-meta", '<script type="application/json" id="deck-meta"> 블록이 없다. head에 {"title": "덱 제목"}을 담아 넣는다');
  else {
    try {
      const m = JSON.parse(metaS.body);
      // 필드 규칙은 engine/deck-meta.ts 한 곳이다. 오류 메시지는 예전 한국어를 그대로 쓰고, 새로 생긴 규칙은 경고로 낸다.
      const KO: Record<string, string> = {
        "title-missing": 'deck-meta에 title이 없다. "title": "덱 제목"을 적는다',
        "date-format": "deck-meta의 date 형식이 틀렸다. 2026-10-14처럼 적는다",
        visibility: 'deck-meta의 visibility는 "public" 또는 "password"여야 한다',
        "id-format": "deck-meta의 id는 영문 소문자, 숫자, -만 쓴다(예: my-talk)",
      };
      for (const i of validateMeta(m)) {
        if (KO[i.code]) add("error", "deck-meta", KO[i.code]);
        else add("warn", "deck-meta", `deck-meta의 ${i.field || "내용"}: ${i.msg}`);
      }
    } catch { add("error", "deck-meta", "deck-meta JSON을 읽지 못했다. 쉼표와 따옴표를 확인한다"); }
  }
  if (!/slidekit\.css/.test(rest)) add("error", "engine", 'head에 <link rel="stylesheet" href="../../engine/slidekit.css">를 넣는다');
  const eng = scripts.findIndex((s) => /slidekit\.js/.test(s.attrs));
  if (eng < 0) add("error", "engine", 'body 끝에 <script src="../../engine/slidekit.js"></script>를 넣는다');
  else if (scripts.slice(0, eng).some((s) => !/application\/json|slidekit\.js/.test(s.attrs) && s.body.trim())) add("error", "engine", "덱 스크립트를 slidekit.js 뒤로 옮긴다");

  // body 안을 태그 단위로 훑어 깊이를 센다
  const bodyM = rest.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
  const body = bodyM ? bodyM[1] : "";
  if (!bodyM) add("error", "body", "<body>가 없다");
  type Sl = { kind: string; title: string | null; steps: number; id: string | null; notes: number; text: string; dsteps: string[]; layout: string | null; cols: number; bigs: number; quotes: number; imgs: number };
  const slides: Sl[] = [];
  const stack: string[] = [];
  let cur: Sl | null = null;
  let last = 0;
  const wrappers: string[] = [];
  for (const m of body.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g)) {
    const [, close, tag0, attrs] = m;
    const tag = tag0.toLowerCase();
    if (cur) cur.text += body.slice(last, m.index);
    last = m.index! + m[0].length;
    if (close) { const k = stack.lastIndexOf(tag); if (k >= 0) stack.length = k; /* 생략된 닫는 태그(li, p)를 건너뛴다 */ if (tag === "section" && stack.length === 0) cur = null; continue; }
    const at = (n: string) => attrs.match(new RegExp(`\\b${n}=(?:"([^"]*)"|'([^']*)')`))?.[1] ?? attrs.match(new RegExp(`\\b${n}=(?:'([^']*)')`))?.[1] ?? null;
    if (/\b(?:id|class)=["'][^"']*\b(viewport|stage)\b/i.test(attrs)) wrappers.push(tag);
    if (cur) {
      const ds = at("data-step"); if (ds !== null) cur.dsteps.push(ds.trim());
      if (/\bdata-col\b/.test(attrs)) cur.cols++;
      if (/\bdata-big\b/.test(attrs)) cur.bigs++;
      if (tag === "blockquote") cur.quotes++;
      if (tag === "img") cur.imgs++;
    }
    if (stack.length === 0 && !["section", "script"].includes(tag)) add("error", "wrapper", `<${tag}>가 슬라이드 밖에 있다. 모든 요소를 <section data-slide> 안으로 옮긴다`);
    if (stack.length === 0 && tag === "section") {
      const kind = at("data-slide");
      if (kind === null) add("error", "slide", '<section>에 data-slide="content"를 붙인다(cover, chapter, content, end 중 하나)');
      cur = { kind: kind ?? "", title: at("data-title"), steps: Number(at("data-steps") ?? 1), id: at("id"), notes: 0, text: "", dsteps: [], layout: at("data-layout"), cols: 0, bigs: 0, quotes: 0, imgs: 0 };
      slides.push(cur);
    } else if (cur && tag === "aside" && /\bdata-notes\b/.test(attrs)) {
      if (stack.length !== 1) add("error", "notes", `슬라이드 ${slides.length}: aside[data-notes]는 슬라이드의 직계 자식이어야 한다`);
      cur.notes++;
    }
    if (!VOID.has(tag) && !/\/$/.test(attrs)) stack.push(tag);
  }
  if (wrappers.length) add("error", "wrapper", "viewport, stage 이름의 래퍼를 지운다. 화면 맞춤은 엔진이 맡는다");
  if (!slides.length) add("error", "slide", "슬라이드가 없다");

  slides.forEach((s, i) => {
    const n = i + 1;
    if (s.kind && !KINDS.includes(s.kind)) add("warn", "slide", `슬라이드 ${n}: data-slide="${s.kind}"는 알 수 없는 종류라 content로 처리된다. cover, chapter, content, end 중 하나로 바꾼다`);
    if (s.layout !== null) {
      if (s.kind !== "content") add("warn", "layout", `슬라이드 ${n}: data-layout은 content 슬라이드에서만 쓴다(지금 ${s.kind || "종류 없음"})`);
      else if (!LAYOUT_IDS.includes(s.layout)) add("warn", "layout", `슬라이드 ${n}: data-layout="${s.layout}"는 알 수 없는 값이다. ${LAYOUT_IDS.join(", ")} 중 하나로 바꾼다(slidekit layouts)`);
      else if (s.layout === "two-column" && s.cols < 2) add("warn", "layout", `슬라이드 ${n}: two-column에는 data-col 요소가 둘 필요하다(지금 ${s.cols}개). 없으면 한 줄로 쌓여 보인다`);
      else if (s.layout === "big-number" && s.bigs !== 1) add("warn", "layout", `슬라이드 ${n}: big-number에는 data-big 요소가 하나 필요하다(지금 ${s.bigs}개)`);
      else if (s.layout === "quote" && s.quotes < 1) add("warn", "layout", `슬라이드 ${n}: quote에는 <blockquote>가 필요하다`);
      else if (s.layout === "image-full" && s.imgs < 1) add("warn", "layout", `슬라이드 ${n}: image-full에는 <img>가 필요하다`);
    }
    if (s.kind === "chapter") {
      if (!s.title) add("error", "chapter", `슬라이드 ${n}: chapter에 data-title="장 이름"을 달고 h1에도 같은 글자를 쓴다`);
      else {
        const h1 = s.text.match(/^\s*$/) ? "" : s.text.replace(/\s+/g, " ").trim();
        if (!h1.includes(s.title.trim())) add("warn", "chapter", `슬라이드 ${n}: data-title이 본문 h1의 글자와 다르다. 한쪽을 맞춘다`);
      }
    }
    if (s.notes > 1) add("error", "notes", `슬라이드 ${n}: 노트 aside[data-notes]가 ${s.notes}개다. 슬라이드당 하나로 합친다`);
    const bad = s.dsteps.filter((v) => !/^\d+$/.test(v) || Number(v) < 2);
    if (bad.length) add("error", "data-step", `슬라이드 ${n}: data-step은 2 이상의 정수여야 한다(잘못된 값: ${[...new Set(bad)].join(", ")}). 처음부터 보이는 요소에는 속성을 달지 않는다`);
    const have = new Set(s.dsteps.filter((v) => /^\d+$/.test(v)).map(Number));
    for (const k of [...have].sort((a, b) => a - b)) if (k >= 3 && !have.has(k - 1)) add("warn", "data-step", `슬라이드 ${n}: 단계 ${k}가 있는데 단계 ${k - 1}에 요소가 없다. data-step을 2부터 빠짐없이 차례로 쓴다`);
    if (s.steps > 1) {
      const reg = scripts.some((c) => /SlideKit\.stepper\s*\(/.test(c.body) && (!s.id || c.body.includes(s.id)));
      if (!s.id) add("error", "steps", `슬라이드 ${n}: data-steps를 쓰려면 section에 id를 달고 SlideKit.stepper로 등록한다. 요소만 단계별로 나타내려면 data-step을 쓴다`);
      if (!reg) add("error", "steps", `슬라이드 ${n}: data-steps="${s.steps}"인데 SlideKit.stepper 등록이 없다. 요소만 나타내려면 data-steps 대신 요소에 data-step을 쓴다`);
    }
  });
  const kinds = slides.map((s) => s.kind);
  if (kinds.filter((k) => k === "cover").length > 1) add("error", "cover", "cover는 첫 슬라이드 하나만 둔다");
  if (kinds.includes("cover") && kinds[0] !== "cover") add("error", "cover", "cover를 첫 슬라이드로 옮긴다");
  if (kinds.filter((k) => k === "end").length > 1) add("error", "end", "end는 마지막 슬라이드 하나만 둔다");
  if (kinds.includes("end") && kinds.at(-1) !== "end") add("error", "end", "end를 마지막 슬라이드로 옮긴다");

  // 금지 문자: 보이는 글자, 노트, data-title
  const visible = rest.replace(/<[^>]+>/g, "\n") + "\n" + (rest.match(/data-title="[^"]*"/g) ?? []).join("\n");
  const CHAR_NAMES: Record<string, string> = { "\u2014": "em-dash", "\u2013": "en-dash", "\u00b7": "가운뎃점", "\u30fb": "가운뎃점", "\u2022": "불릿 문자" };
  visible.split("\n").forEach((l) => {
    const m = l.match(BAD_CHARS);
    if (m) add("error", "chars", `금지 문자 ${CHAR_NAMES[m[0]] ?? "이모지"}(U+${m[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}). 쉼표나 마침표, 단어로 바꾼다: ${l.trim().slice(0, 40)}`);
  });

  const css = styles.join("\n") + "\n" + (rest.match(/style="[^"]*"/g) ?? []).join("\n");
  if (/\d(?:\.\d+)?\s*(?:vw|vh)\b/i.test(css)) add("error", "units", "vw, vh 단위를 px로 바꾼다. 슬라이드는 1920x1080 고정이다");
  const js = scripts.filter((s) => !/slidekit\.js|application\/json/.test(s.attrs)).map((s) => s.body).join("\n");
  if (/addEventListener\(\s*['"](?:wheel|touchstart|touchend|pointerdown|click)['"]/.test(js) || /\bonclick=/.test(rest)) add("warn", "nav", "슬라이드 이동은 방향키만 쓴다. click, wheel, touch 핸들러를 이동에 쓰지 않는다");
  // 덱은 앱과 같은 출처에서 열리는 신뢰된 콘텐츠다. 외부나 앱 API 호출은 앱의 덱, 휴지통, 배포 API를 부를 수 있어 쓰지 않는다.
  if (/\b(?:fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon)/.test(js) || /['"`]\/api\//.test(js)) add("warn", "network", "덱 스크립트가 네트워크를 호출한다(fetch, XMLHttpRequest, WebSocket, EventSource, /api/). 덱은 외부 호출 없이 동작해야 하고 앱 API를 부르면 안 된다");
  if (/['"](?:Space|PageDown|PageUp)['"]|key\s*===?\s*['"] ['"]/.test(js)) add("error", "nav", "스페이스와 PageUp, PageDown 이동은 쓰지 않는다. 방향키만 쓴다");
  for (const m of rest.matchAll(/\b(?:src|href)=["'](https?:\/\/[^"']+)/g)) if (!/fonts\.(?:googleapis|gstatic)\.com|font|pretendard|woff/i.test(m[1])) add("warn", "external", `외부 리소스: ${m[1].slice(0, 60)}. 파일을 덱 폴더에 내려받아 상대 경로로 쓴다(글꼴 CSS는 번들 때 인라인된다)`);
  for (const m of css.matchAll(/url\(\s*["']?(https?:\/\/[^)"']+)/g)) if (!/fonts\.(?:googleapis|gstatic)\.com/.test(m[1])) add("warn", "external", `외부 리소스: ${m[1].slice(0, 60)}. 파일을 덱 폴더에 내려받아 상대 경로로 쓴다`);
  // 이미지의 대체 텍스트: alt 속성이 없으면 경고한다(장식이면 alt=""를 쓴다).
  const noAlt = [...rest.matchAll(/<img\b[^>]*>/gi)].filter((m) => !/\balt\s*=/i.test(m[0])).length;
  if (noAlt) add("warn", "img-alt", `<img> ${noAlt}개에 alt가 없다. 내용을 설명하는 alt를 적고, 장식이면 alt=""로 둔다`);
  // 템플릿의 예제 문구가 남은 채 배포되는 것을 막는다(engine/templates.ts의 문구와 편집기의 새 슬라이드 기본값).
  const PLACEHOLDER = /여기에 적는다|핵심 문장 하나|뒷받침하는 설명을 짧게 쓴다|작은 글자는 보조 정보에만 쓴다|두 번째 본문/;
  const phText = rest.replace(/<[^>]+>/g, " ") + " " + (metaS?.body ?? "");
  const phAll = [...phText.matchAll(new RegExp(`.{0,16}(?:${PLACEHOLDER.source})`, "g"))].map((m) => m[0].replace(/\s+/g, " ").trim());
  if (phAll.length) add("warn", "placeholder", `예제 문구가 ${phAll.length}곳에 남아 있다("${phAll[0]}"${phAll.length > 1 ? " 등" : ""}). 새 덱의 예제는 실제 내용으로 바꾼 뒤 배포한다. 만드는 중에는 무시해도 된다`);
  if (/<h2>\s*제목\s*<\/h2>\s*<p>\s*내용\s*<\/p>/.test(rest)) add("warn", "placeholder", '제목이 "제목", 본문이 "내용"인 새 슬라이드가 남아 있다. 실제 내용으로 바꾸거나 지운다');
  return out;
}

/** CLI 본체. 앱 서버가 이 파일을 정적으로 import해도(공개 API 검사 등) 하위 명령 실행에 영향이 없도록 engine/lint-cli.ts에서 부른다. */
export async function runCli(name: string | undefined) {
    if (!name) { console.error("사용법: slidekit lint <덱>  (예: slidekit lint my-talk)"); process.exit(1); }
  const file = join(import.meta.dir, "..", "decks", name, "index.html");
  if (!(await Bun.file(file).exists())) {
    const have = (await import("node:fs")).readdirSync(join(import.meta.dir, "..", "decks")).filter((d) => !d.startsWith(".") && !d.startsWith("_"));
    console.error(`없는 덱: decks/${name}. 있는 덱: ${have.join(", ") || "(없음)"}. 새 덱은 slidekit new <이름>`);
    process.exit(1);
  }
  const text = await Bun.file(file).text();
  const issues = lint(text);
  // 파일 크기가 필요한 검사는 파일을 읽는 CLI에서만 한다(lint 함수는 순수하게 둔다): 400KB를 넘는 로컬 이미지
  for (const r of localImageRefs(text, join(import.meta.dir, "..", "decks", name))) if (r.size > 400 * 1024) issues.push({ level: "warn", rule: "image-size", msg: `이미지 ${r.rel}가 ${(r.size / 1024).toFixed(0)} KB다. 줄이면 번들이 가벼워진다(slidekit image <덱> <파일> --max 1600 으로 다시 저장)` });
  for (const i of issues) console.log(`${i.level} ${i.rule}: ${i.msg}`);
  const errs = issues.filter((i) => i.level === "error").length;
  console.log(errs ? `실패: 오류 ${errs}개` : `통과 (경고 ${issues.length}개)`);
  process.exit(errs ? 1 : 0);
}

if (import.meta.main) await runCli(process.argv[2]);
