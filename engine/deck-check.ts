/* 덱 하나의 점검 요약(node 전용): lint, 크기, 이미지, 노트 현황, 색 대비. `slidekit doctor <덱>`과 앱의 게시 전 점검이 같은 근거를 쓰게 한 곳에 둔다.
   색 대비는 앱의 색 규칙(app/src/lib/deck-colors.ts, WCAG)을 그대로 쓴다. */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { contrastRatio, resolveVar, wcagLevel } from "../app/src/lib/deck-colors";
import { readTokens } from "../app/src/lib/deck-tokens";
import { type Issue, lint } from "./lint";
import { localImageRefs } from "./publish-record";

export const LARGE_IMAGE = 400 * 1024; // 번들러와 lint의 큰 이미지 기준
export const LONG_NOTES = 800; // 글자 수

export type ContrastRow = { name: string; on: string; fg: string; bg: string; ratio: number | null; need: number; level: "AAA" | "AA" | "fail" | "?" };
export type DeckCheck = {
  deck: string;
  title: string;
  visibility: "public" | "password" | "unknown";
  slides: number;
  lint: { errors: number; warnings: number; issues: Issue[] };
  size: { htmlBytes: number; imageBytes: number; estimatedBytes: number; lastBundleBytes: number | null };
  images: { rel: string; size: number }[];
  largeImages: { rel: string; size: number }[];
  notes: { missing: number[]; long: { n: number; chars: number }[] };
  contrast: ContrastRow[];
};

/** 엔진 CSS의 :root 기본값(토큰 이름 -> 값) */
function engineDefaults(): Record<string, string> {
  const css = readFileSync(join(import.meta.dir, "slidekit.css"), "utf8");
  const root = css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? "";
  return Object.fromEntries([...root.matchAll(/(--sk-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

function notesOf(html: string) {
  const sections = [...html.matchAll(/<section\b[^>]*\bdata-slide\b[^>]*>[\s\S]*?<\/section>/gi)].map((m) => m[0]);
  const missing: number[] = [], long: { n: number; chars: number }[] = [];
  sections.forEach((s, i) => {
    const a = s.match(/<aside\b[^>]*\bdata-notes\b[^>]*>([\s\S]*?)<\/aside>/i);
    const chars = a ? a[1].replace(/<[^>]+>/g, "").trim().length : 0;
    if (!chars) missing.push(i + 1);
    else if (chars > LONG_NOTES) long.push({ n: i + 1, chars });
  });
  return { slides: sections.length, missing, long };
}

export function deckCheck(deckDir: string, deck = deckDir.split("/").pop() ?? ""): DeckCheck {
  const file = join(deckDir, "index.html");
  const html = readFileSync(file, "utf8");
  const issues = lint(html);
  const imgs = localImageRefs(html, deckDir);
  const imageBytes = imgs.reduce((n, r) => n + r.size, 0), htmlBytes = Buffer.byteLength(html);
  const metaRaw = html.match(/<script[^>]*id="deck-meta"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  let meta: { title?: unknown; visibility?: unknown } = {};
  try { meta = JSON.parse(metaRaw ?? ""); } catch { /* lint가 알려 준다 */ }
  const bundle = join(deckDir, "..", "..", "dist", `${deck}.html`);
  const built = existsSync(bundle) && statSync(bundle).mtimeMs > statSync(file).mtimeMs ? statSync(bundle).size : null;
  const n = notesOf(html);

  const tokens = { ...engineDefaults(), ...readTokens(html) };
  const val = (name: string) => { const r = resolveVar(tokens[name] ?? "", tokens); return r ?? tokens[name] ?? ""; };
  const bg = val("--sk-bg");
  const rows: ContrastRow[] = [["--sk-fg", "Text", 4.5], ["--sk-muted", "Muted text", 4.5], ["--sk-faint", "Faint text", 4.5], ["--sk-accent", "Accent (large text, graphics)", 3]].map(([name, label, need]) => {
    const fg = val(name as string), ratio = contrastRatio(fg, bg);
    return { name: name as string, on: "--sk-bg", fg, bg, ratio, need: need as number, level: ratio === null ? "?" : wcagLevel(ratio, need === 3) };
  });
  return {
    deck,
    title: typeof meta.title === "string" ? meta.title : deck,
    visibility: meta.visibility === "password" ? "password" : metaRaw ? "public" : "unknown",
    slides: n.slides,
    lint: { errors: issues.filter((i) => i.level === "error").length, warnings: issues.filter((i) => i.level === "warn").length, issues },
    size: { htmlBytes, imageBytes, estimatedBytes: htmlBytes + imageBytes, lastBundleBytes: built },
    images: imgs.sort((a, b) => b.size - a.size),
    largeImages: imgs.filter((r) => r.size > LARGE_IMAGE),
    notes: { missing: n.missing, long: n.long },
    contrast: rows,
  };
}

const kb = (b: number) => `${(b / 1024).toFixed(0)} KB`;
const list = (xs: number[], max = 12) => (xs.length > max ? `${xs.slice(0, max).join(", ")} 외 ${xs.length - max}개` : xs.join(", "));

/** 한 화면 요약. 줄은 `OK`나 `WARN`으로 시작한다(doctor와 같은 모양). */
export function formatCheck(c: DeckCheck): string[] {
  const row = (ok: boolean, name: string, msg: string) => `${ok ? "OK  " : "WARN"} ${name.padEnd(8)} ${msg}`;
  const out = [`덱 ${c.deck}: "${c.title}", ${c.slides}장, ${c.visibility === "password" ? "비밀번호" : c.visibility === "public" ? "공개" : "공개 범위 알 수 없음"}`, ""];
  out.push(row(c.lint.errors === 0, "lint", `오류 ${c.lint.errors}, 경고 ${c.lint.warnings}`));
  for (const i of c.lint.issues.slice(0, 5)) out.push(`       ${i.level} ${i.rule}: ${i.msg}`);
  if (c.lint.issues.length > 5) out.push(`       그 밖의 ${c.lint.issues.length - 5}건은 bun run slidekit lint ${c.deck}`);
  out.push(row(true, "크기", `index.html ${kb(c.size.htmlBytes)}, 이미지 ${c.images.length}개 ${kb(c.size.imageBytes)}, 예상 번들 ${kb(c.size.estimatedBytes)}(글꼴 서브셋은 번들 때 더해진다)${c.size.lastBundleBytes ? `, 마지막 번들 ${kb(c.size.lastBundleBytes)}` : ""}`));
  out.push(row(c.largeImages.length === 0, "이미지", c.largeImages.length ? `${kb(LARGE_IMAGE)}를 넘는 이미지 ${c.largeImages.length}개: ${c.largeImages.slice(0, 3).map((r) => `${r.rel} ${kb(r.size)}`).join(", ")}. slidekit image <덱> <파일> --max 1600 으로 다시 저장` : `${kb(LARGE_IMAGE)}를 넘는 이미지 없음`));
  const noNotes = c.notes.missing.length === c.slides && c.slides > 0;
  out.push(row(!noNotes && c.notes.long.length === 0, "노트", noNotes ? "노트가 하나도 없다. 발표자 화면의 노트와 리허설 요약이 비어 있게 된다" : `노트 없는 장 ${c.notes.missing.length}개${c.notes.missing.length ? `(${list(c.notes.missing)})` : ""}${c.notes.long.length ? `, ${LONG_NOTES}자를 넘는 노트 ${c.notes.long.length}개(${c.notes.long.map((x) => `${x.n}번 ${x.chars}자`).join(", ")})` : ""}`));
  const bad = c.contrast.filter((r) => r.level === "fail");
  out.push(row(bad.length === 0, "대비", bad.length ? bad.map((r) => `${r.name} ${r.fg} 위 ${r.bg} ${r.ratio!.toFixed(2)}:1(${r.need}:1 필요)`).join("; ") + ". 토큰 패널에서 색을 밝히거나 어둡게 한다" : c.contrast.map((r) => `${r.name.replace("--sk-", "")} ${r.ratio?.toFixed(1) ?? "?"}:1`).join(", ")));
  return out;
}
