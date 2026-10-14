import { expect, test } from "bun:test";
import { join } from "node:path";
import { runUnpublish, type KvOps } from "./unpublish-core";

const fake = (store: Record<string, string>) => {
  const dels: string[] = [];
  const ops: KvOps = { get: (k) => store[k] ?? null, list: (p) => Object.keys(store).filter((k) => k.startsWith(p)), del: (k) => { dels.push(k); delete store[k]; } };
  return { ops, dels };
};
const lines = () => { const out: string[] = []; return { out, log: (s: string) => out.push(s) }; };

test("--yes 없이는 대상 목록만 보이고 종료 코드 2, 아무것도 지우지 않는다", () => {
  const { ops, dels } = fake({ "meta:a": JSON.stringify({ visibility: "password", title: "비밀" }), "html:a": "x", "rl:a:1.1.1.1": "{}", "meta:b": "{}" });
  const { out, log } = lines();
  expect(runUnpublish("a", { yes: false, dry: false }, ops, log)).toBe(2);
  expect(dels).toEqual([]);
  const t = out.join("\n");
  expect(t).toContain("html:a"); expect(t).toContain("meta:a"); expect(t).toContain("rl:a:1.1.1.1"); expect(t).toContain("--yes"); expect(t).toContain("비밀번호");
  expect(t).not.toContain("meta:b");
});
test("--yes면 html, meta, 시도 카운터 순으로 지우고 다른 덱은 건드리지 않는다", () => {
  const { ops, dels } = fake({ "meta:a": "{}", "html:a": "x", "rl:a:9.9.9.9": "{}", "meta:ab": "{}", "html:ab": "y" });
  expect(runUnpublish("a", { yes: true, dry: false }, ops, lines().log)).toBe(0);
  expect(dels).toEqual(["html:a", "meta:a", "rl:a:9.9.9.9"]);
});
test("게시되지 않은 덱은 오류 1과 게시된 덱 목록(이름이 비슷한 덱 포함)을 보인다", () => {
  const { ops, dels } = fake({ "meta:x": "{}", "html:x": "y" });
  const { out, log } = lines();
  expect(runUnpublish("nope", { yes: true, dry: false }, ops, log)).toBe(1);
  expect(out.join("\n")).toContain("게시된 덱: x");
  expect(dels).toEqual([]);
});
test("dry-run은 ops 없이도 지울 키만 출력하고 0", () => {
  const { out, log } = lines();
  expect(runUnpublish("a", { yes: true, dry: true }, null, log)).toBe(0);
  expect(out.join("\n")).toContain("meta:a");
  expect(out.join("\n")).toContain("삭제는 하지 않았습니다");
});
test("CLI: 인자 없음과 잘못된 이름은 종료 코드 1, dry-run은 접속 없이 0", () => {
  const run = (args: string[], env: Record<string, string> = {}) => {
    const r = Bun.spawnSync(["bun", join(import.meta.dir, "unpublish.ts"), ...args], { env: { ...process.env, SLIDEKIT_DEPLOY_DRY_RUN: "", CLOUDFLARE_API_TOKEN: "", ...env }, stdout: "pipe", stderr: "pipe" });
    return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
  };
  expect(run([], { SLIDEKIT_DEPLOY_DRY_RUN: "1" }).code).toBe(1);
  expect(run(["../x"], { SLIDEKIT_DEPLOY_DRY_RUN: "1" }).code).toBe(1);
  const d = run(["my-talk"], { SLIDEKIT_DEPLOY_DRY_RUN: "1" });
  expect(d.code).toBe(0);
  expect(d.out).toContain("html:my-talk");
  expect(d.out).toContain("DRY RUN");
  expect(run(["my-talk", "--dry-run", "--yes"]).code).toBe(0);
});
