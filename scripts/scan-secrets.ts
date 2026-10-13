#!/usr/bin/env bun
// 커밋 전 비밀 값 검사: 스테이징된 diff의 추가된 줄만 본다. 사용: bun scripts/scan-secrets.ts [--stdin]
// --stdin: git log -p 같은 diff 텍스트를 표준 입력으로 받는다. 찾으면 종료 코드 1, 값은 앞 4글자만 보여 준다.
// 허용 목록: scripts/scan-secrets.allow (줄마다 `파일경로:찾은 글자의 일부`, `#` 주석, 파일 쪽은 경로 일부 일치, 글자 쪽이 `*`면 그 파일 전체).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Finding = { file: string; line: number; rule: string; value: string };

const PLACEHOLDER = /\$\{|\$\(|\$[A-Z_]+|process\.env|import\.meta\.env|REPLACE|example|placeholder|your[-_ ]|<[^>]+>|x{6,}|\*{3,}/i;
const RULES: { name: string; re: RegExp; group?: number }[] = [
  { name: "GitHub token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/ },
  { name: "Anthropic or OpenAI key", re: /\bsk-(?:ant-)?[A-Za-z0-9_-]{24,}/ },
  { name: "Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: "AWS access key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: "AWS secret key", re: /aws_secret_access_key["']?\s*[:=]\s*["']?([A-Za-z0-9/+]{40})\b/i, group: 1 },
  { name: "Private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "Telegram bot token", re: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/ },
  { name: "Cloudflare token assignment", re: /CLOUDFLARE_API_TOKEN["']?\s*[:=]\s*["']?([A-Za-z0-9_-]{20,})/, group: 1 },
  { name: "healthchecks ping URL", re: /hc-ping\.com\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i, group: 1 },
  { name: "secret-like assignment", re: /(?:secret|token|passwd|password|api[_-]?key|access[_-]?key)\w*["']?\s*[:=]\s*["']([^"'\s]{20,})["']/i, group: 1 },
];

function loadAllow(path = join(import.meta.dir, "scan-secrets.allow")) {
  if (!existsSync(path)) return [] as [string, string][];
  return readFileSync(path, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf(":"); return [l.slice(0, i), l.slice(i + 1)] as [string, string]; });
}

export function scan(diff: string, allow = loadAllow()): Finding[] {
  const out: Finding[] = [];
  let file = "", line = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ ")) { file = raw.slice(4).replace(/^b\//, ""); continue; }
    if (raw.startsWith("--- ") || raw.startsWith("diff ")) continue;
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw);
    if (h) { line = +h[1]; continue; }
    if (raw.startsWith("+")) {
      const text = raw.slice(1);
      for (const r of RULES) {
        const m = r.re.exec(text);
        if (!m) continue;
        const value = m[r.group ?? 0];
        if (PLACEHOLDER.test(value) || (r.group && PLACEHOLDER.test(text.slice(Math.max(0, m.index - 2), m.index + 40)) && /\$|process\.env/.test(text))) continue;
        if (allow.some(([f, p]) => file.includes(f) && (p === "*" || text.includes(p) || value.includes(p)))) continue;
        out.push({ file, line, rule: r.name, value });
        break;
      }
      line++;
    } else if (!raw.startsWith("-") && !raw.startsWith("\\")) line++;
  }
  return out;
}

if (import.meta.main) {
  let diff: string;
  if (process.argv.includes("--stdin")) diff = await Bun.stdin.text();
  else {
    const r = Bun.spawnSync(["git", "diff", "--cached", "-U0", "--no-color", "--no-ext-diff"], { stdout: "pipe", stderr: "pipe" });
    if (r.exitCode !== 0) { console.error("git diff 실패:", r.stderr.toString()); process.exit(2); }
    diff = r.stdout.toString();
  }
  const found = scan(diff);
  for (const f of found) console.error(`${f.file}:${f.line}  ${f.rule}  ${f.value.slice(0, 4)}***`);
  if (found.length) {
    console.error(`\n비밀 값으로 보이는 ${found.length}건. 키체인으로 옮기거나, 비밀이 아니면 scripts/scan-secrets.allow에 \`파일:글자\`로 허용한다.`);
    process.exit(1);
  }
}
