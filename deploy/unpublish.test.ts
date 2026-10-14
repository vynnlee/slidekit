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
test("--yes면 meta, html, 시도 카운터 순으로 지우고 다른 덱은 건드리지 않는다", () => {
  const { ops, dels } = fake({ "meta:a": "{}", "html:a": "x", "rl:a:9.9.9.9": "{}", "meta:ab": "{}", "html:ab": "y" });
  const { out, log } = lines();
  expect(runUnpublish("a", { yes: true, dry: false }, ops, log)).toBe(0);
  expect(dels).toEqual(["meta:a", "html:a", "rl:a:9.9.9.9"]);
  expect(out.at(-1)).toBe("Unpublished https://static.vynnlee.com/a");
});
test("게시되지 않은 덱은 종료 코드 3(다른 실패는 1)과 게시된 덱 목록을 보인다", () => {
  const { ops, dels } = fake({ "meta:x": "{}", "html:x": "y" });
  const { out, log } = lines();
  expect(runUnpublish("nope", { yes: true, dry: false }, ops, log)).toBe(3);
  expect(out.join("\n")).toContain("게시된 덱: x");
  expect(dels).toEqual([]);
});
test("dry-run은 ops 없이도 지울 키만 출력하고 0", () => {
  const { out, log } = lines();
  expect(runUnpublish("a", { yes: true, dry: true }, null, log)).toBe(0);
  expect(out[0]).toBe("Dry run: would delete meta:a, html:a (and rl:a:* login counters if any)");
  expect(out.join("\n")).not.toContain("Unpublished");
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
  expect(d.out).toContain("Dry run: would delete meta:my-talk, html:my-talk");
  expect(d.out).not.toContain("Unpublished");
  expect(run(["my-talk", "--dry-run", "--yes"]).code).toBe(0);
});

test("로그에 찍히는 KV의 제목과 덱 이름은 한 줄로 정리된다(줄바꿈, 제어 문자, 양방향 문자 제거, 80자)", () => {
  const evil = "x\n게시된 덱: victim\u202E\u0000y" + "z".repeat(200);
  const { ops } = fake({ "meta:a": JSON.stringify({ title: evil, visibility: "public" }), "html:a": "x", "meta:b\nvictim": "{}" });
  const { out, log } = lines();
  expect(runUnpublish("a", { yes: false, dry: false }, ops, log)).toBe(2);
  const title = out.find((l) => l.startsWith("게시 취소 대상"))!;
  expect(title).not.toMatch(/[\n\u202E\u0000]/);
  expect(title.length).toBeLessThan(140);
  const miss = lines();
  expect(runUnpublish("zzz", { yes: false, dry: false }, ops, miss.log)).toBe(3);
  expect(miss.out.join("|")).not.toContain("\n");
});
