/* slidekit pdf <덱>: 번들한 덱을 헤드리스 Chrome으로 인쇄해 dist/<덱>.pdf를 만든다.
   Chrome: SLIDEKIT_CHROME, 없으면 ~/Library/Caches/ms-playwright 의 chrome-headless-shell. 다운로드하지 않는다. */
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const name = process.argv[2];
if (!name) { console.error("usage: slidekit pdf <덱>"); process.exit(1); }

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
const html = join(root, "dist", `${name}.html`), out = join(root, "dist", `${name}.pdf`);
const r = Bun.spawnSync([chrome, "--headless", "--disable-gpu", "--no-pdf-header-footer", "--print-to-pdf-no-header", `--print-to-pdf=${out}`, "--virtual-time-budget=5000", `file://${html}`], { stdout: "ignore", stderr: "pipe" });
if (!existsSync(out) || r.exitCode !== 0) { console.error(r.stderr.toString().slice(-400) || "PDF 생성 실패"); process.exit(1); }
const pages = (Buffer.from(await Bun.file(out).arrayBuffer()).toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;
console.log(`${out}  ${pages}페이지  ${(statSync(out).size / 1024).toFixed(0)} KB`);
