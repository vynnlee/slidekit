/* slidekit pdf <덱> [--notes | --handout [2|3|4|6]]: 번들한 덱을 헤드리스 Chrome으로 인쇄해 dist/<덱>.pdf를 만든다.
   --notes는 A4 세로 쪽마다 슬라이드 한 장과 마크다운으로 렌더한 노트(dist/<덱>.notes.pdf), --handout은 쪽마다 슬라이드 2, 3, 4, 6장 격자(dist/<덱>.handout.pdf, 기본 3).
   Chrome: SLIDEKIT_CHROME, 없으면 ~/Library/Caches/ms-playwright 의 chrome-headless-shell. 다운로드하지 않는다. */
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const args = process.argv.slice(2);
const USAGE = "사용법: slidekit pdf <덱> [--notes | --handout [2|3|4|6]]  (예: slidekit pdf my-talk --notes)";
const hi = args.indexOf("--handout");
let per = 3;
if (hi >= 0 && /^\d+$/.test(args[hi + 1] ?? "")) { per = Number(args[hi + 1]); args.splice(hi + 1, 1); }
const notes = args.includes("--notes"), handout = hi >= 0;
const name = args.find((a) => !a.startsWith("--"));
if (!name) { console.error(USAGE); process.exit(1); }
if (notes && handout) { console.error(`--notes와 --handout은 함께 쓸 수 없다. ${USAGE}`); process.exit(1); }
if (![2, 3, 4, 6].includes(per)) { console.error(`--handout은 쪽당 2, 3, 4, 6장만 된다(받은 값 ${per}). ${USAGE}`); process.exit(1); }
const mode = notes ? "notes" : handout ? "handout" : "slides";

function findChrome(): string | null {
  const env = process.env.SLIDEKIT_CHROME;
  if (env) return existsSync(env) ? env : null;
  const base = join(homedir(), "Library", "Caches", "ms-playwright");
  if (!existsSync(base)) return null;
  const dirs = readdirSync(base).filter((d) => d.startsWith("chromium_headless_shell-")).sort().reverse();
  for (const d of dirs) for (const sub of readdirSync(join(base, d))) {
    const exe = join(base, d, sub, "chrome-headless-shell");
    if (existsSync(exe)) return exe;
  }
  return null;
}

const chrome = findChrome();
if (!chrome) {
  console.error("Chrome를 찾지 못했다. SLIDEKIT_CHROME에 chrome-headless-shell(또는 Chrome) 실행 파일 경로를 지정한다.\n예: SLIDEKIT_CHROME=\"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome\" slidekit pdf " + name);
  process.exit(1);
}

const b = Bun.spawnSync(["bun", join(root, "bundler", "bundle.ts"), name], { stdout: "ignore", stderr: "inherit" });
if (b.exitCode !== 0) process.exit(b.exitCode ?? 1);
const bundled = join(root, "dist", `${name}.html`);
const out = join(root, "dist", `${name}${mode === "slides" ? "" : "." + mode}.pdf`);
let html = bundled;
if (mode !== "slides") {
  // 유인물 모드: 번들 사본에 CSS, 노트 렌더용 markdown(앱과 같은 코드), 배치 스크립트를 덧붙여 인쇄한다. 엔진 파일은 바뀌지 않는다.
  html = join(root, "dist", `${name}.print.html`);
  const md = new Bun.Transpiler({ loader: "ts" }).transformSync(readFileSync(join(root, "app", "src", "lib", "markdown.ts"), "utf8")).replace(/\bexport\s+/g, "");
  const extra = `<style>${readFileSync(join(import.meta.dir, "handout.css"), "utf8")}</style><script>window.__SK_HANDOUT=${JSON.stringify({ mode, per })};${md}\nwindow.markdown=markdown;</script><script>${readFileSync(join(import.meta.dir, "handout.js"), "utf8")}</script>`;
  const src = readFileSync(bundled, "utf8");
  writeFileSync(html, src.includes("</body>") ? src.replace("</body>", () => extra + "</body>") : src + extra);
}
const r = Bun.spawnSync([chrome, "--headless", "--disable-gpu", "--no-pdf-header-footer", "--print-to-pdf-no-header", `--print-to-pdf=${out}`, "--virtual-time-budget=5000", `file://${html}`], { stdout: "ignore", stderr: "pipe" });
if (html !== bundled && !process.env.SLIDEKIT_KEEP_PRINT) rmSync(html, { force: true }); // 확인용: SLIDEKIT_KEEP_PRINT=1이면 인쇄용 사본을 남긴다
if (!existsSync(out) || r.exitCode !== 0) { console.error(r.stderr.toString().slice(-400) || "PDF 생성 실패"); process.exit(1); }
const pages = (Buffer.from(await Bun.file(out).arrayBuffer()).toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;
console.log(`${out}  ${pages}페이지  ${(statSync(out).size / 1024).toFixed(0)} KB`);
