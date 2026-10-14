import { expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const dir = join(root, "decks", "_bundletest");

test("쿼리 이미지, module 스크립트, style 속성 url, poster를 인라인한다", async () => {
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(join(dir, "my img.png"), Buffer.from("iVBORw0KGgo=", "base64"));
    writeFileSync(join(dir, "m.js"), "export const a = 1;");
    writeFileSync(join(dir, "index.html"), `<!doctype html><html data-slidekit="1"><head><title>t</title>
<script type="application/json" id="deck-meta">{"title":"t"}</script></head><body>
<section data-slide="cover"><img src="my%20img.png?v=2"><div style="background:url(my%20img.png)"></div><video poster="my img.png"></video><img src="my img.png" srcset="my%20img.png 1x, my%20img.png 2x"><picture><source srcset="my%20img.png 800w"></picture></section>
<script type="module" src="m.js"></script></body></html>`);
    const r = Bun.spawnSync(["bun", join(root, "bundler", "bundle.ts"), "_bundletest"], { stderr: "pipe" });
    expect(r.stderr.toString()).toBe("");
    const out = await Bun.file(join(root, "dist", "_bundletest.html")).text();
    expect(out).not.toMatch(/my(%20| )img\.png/);
    expect(out).not.toMatch(/srcset="[^"]*\.png/);
    expect(out).toContain('<script type="module">');
    expect(out.match(/data:image\/png;base64/g)!.length).toBe(7);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(join(root, "dist", "_bundletest.html"), { force: true });
  }
});

test("저장소 밖 경로는 거부한다", () => {
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(join(dir, "index.html"), `<html><body><section data-slide="cover"><img src="../../../../etc/hosts"></section></body></html>`);
    const r = Bun.spawnSync(["bun", join(root, "bundler", "bundle.ts"), "_bundletest"], { stderr: "pipe" });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr.toString()).toContain("덱 폴더 밖");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
