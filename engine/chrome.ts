/* Chrome 실행 파일 찾기(pdf, doctor --layout이 쓴다). SLIDEKIT_CHROME > Playwright의 headless shell > 설치된 Chrome 계열. 다운로드하지 않는다. */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const SYSTEM_CHROMES = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"];

export function findChrome(): string | null {
  const env = process.env.SLIDEKIT_CHROME;
  if (env) return existsSync(env) ? env : null;
  const base = join(homedir(), "Library", "Caches", "ms-playwright");
  if (existsSync(base)) {
    for (const d of readdirSync(base).filter((x) => x.startsWith("chromium_headless_shell-")).sort().reverse())
      for (const sub of readdirSync(join(base, d))) {
        const exe = join(base, d, sub, "chrome-headless-shell");
        if (existsSync(exe)) return exe;
      }
  }
  // Playwright의 headless shell이 없으면 설치된 Chrome 계열을 쓴다(개발용 브라우저를 따로 받지 않은 기계)
  return SYSTEM_CHROMES.find(existsSync) ?? null;
}
