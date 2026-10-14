/* `slidekit doctor <덱> --layout`: 슬라이드 밖으로 나가거나 잘리는 요소를 헤드리스 Chrome으로 잰다(node 전용).
   편집기의 넘침 표시와 같은 함수(app/src/lib/overflow.ts의 findOverflow)의 소스를 덱 사본에 주입해 같은 기준으로 잰다.
   덱 폴더에 임시 사본(index.tmp-layout.html, .tmp-라서 gitignore)을 만들고 끝나면 지운다. 원본은 바꾸지 않는다. */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findChrome } from "./chrome";

export type LayoutIssue = { slide: number; kind: "outside" | "clipped"; dx: number; dy: number; path: string; text: string };
export type LayoutResult = { slides: number; issues: LayoutIssue[] };

/** Chrome이 찍어 준 DOM에서 결과를 읽는다. 없거나 깨졌으면 null */
export function parseLayoutResult(dom: string): LayoutResult | null {
  const m = dom.match(/<pre id="sk-layout-result"[^>]*>([\s\S]*?)<\/pre>/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
    if (typeof j.slides !== "number" || !Array.isArray(j.issues)) return null;
    return { slides: j.slides, issues: j.issues.filter((i: LayoutIssue) => typeof i.slide === "number" && (i.kind === "outside" || i.kind === "clipped")) };
  } catch { return null; }
}

/** 사본에 덧붙일 스크립트: 모든 단계를 보이게 하고 슬라이드마다 findOverflow를 부른 결과를 <pre>에 적는다. */
export function injectedScript(findOverflowSource: string): string {
  return `<script>${findOverflowSource}
window.addEventListener('load', function () { setTimeout(function () {
  document.documentElement.setAttribute('data-sk-show-steps', '');
  var stage = document.getElementById('sk-stage'), out = [];
  var slides = [].filter.call(stage ? stage.children : [], function (e) { return e.hasAttribute && e.hasAttribute('data-slide'); });
  slides.forEach(function (s, i) {
    var prev = s.style.visibility; s.style.visibility = 'visible';
    findOverflow(s).forEach(function (o) { out.push({ slide: i + 1, kind: o.kind, dx: o.dx, dy: o.dy, path: o.path, text: o.text }); });
    s.style.visibility = prev;
  });
  var pre = document.createElement('pre'); pre.id = 'sk-layout-result'; pre.textContent = JSON.stringify({ slides: slides.length, issues: out });
  document.body.appendChild(pre);
}, 700); });</script>`;
}

export function layoutCheck(deckDir: string): { ok: true; result: LayoutResult } | { ok: false; error: string } {
  const chrome = findChrome();
  if (!chrome) return { ok: false, error: "Chrome를 찾지 못해 건너뛴다. SLIDEKIT_CHROME을 지정하거나 Chrome을 설치한다" };
  const root = join(import.meta.dir, "..");
  const src = new Bun.Transpiler({ loader: "ts" }).transformSync(readFileSync(join(root, "app", "src", "lib", "overflow.ts"), "utf8")).replace(/\bexport\s+/g, "");
  const html = readFileSync(join(deckDir, "index.html"), "utf8");
  const copy = join(deckDir, "index.tmp-layout.html");
  try {
    const extra = injectedScript(src);
    writeFileSync(copy, html.includes("</body>") ? html.replace("</body>", () => extra + "</body>") : html + extra);
    const r = Bun.spawnSync([chrome, "--headless", "--disable-gpu", "--window-size=1920,1080", "--virtual-time-budget=4000", "--dump-dom", `file://${copy}`], { stdout: "pipe", stderr: "pipe" });
    const result = parseLayoutResult(r.stdout.toString());
    if (!result) return { ok: false, error: `Chrome에서 결과를 읽지 못했다${r.exitCode ? `(종료 코드 ${r.exitCode})` : ""}` };
    return { ok: true, result };
  } finally { if (existsSync(copy)) rmSync(copy, { force: true }); }
}

/** doctor용 줄들 */
export function formatLayout(r: { ok: true; result: LayoutResult } | { ok: false; error: string }): string[] {
  if (!r.ok) return [`WARN 넘침     ${r.error}`];
  const { issues, slides } = r.result;
  if (!issues.length) return [`OK   넘침     ${slides}장 모두 슬라이드 안에 들어간다`];
  const nums = [...new Set(issues.map((i) => i.slide))];
  const out = [`WARN 넘침     ${issues.length}곳(슬라이드 ${nums.slice(0, 12).join(", ")}${nums.length > 12 ? ` 외 ${nums.length - 12}장` : ""}). 편집기의 넘침 표시로 위치를 본다`];
  for (const i of issues.slice(0, 5)) out.push(`       ${i.slide}번 ${i.kind === "outside" ? "밖으로" : "잘림"} ${i.path || "(슬라이드)"}${i.text ? ` "${i.text}"` : ""} (가로 ${i.dx}px, 세로 ${i.dy}px)`);
  if (issues.length > 5) out.push(`       그 밖의 ${issues.length - 5}곳은 생략`);
  return out;
}
