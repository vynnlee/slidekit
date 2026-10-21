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

test("head: 파비콘, og:title, description, 비밀번호 덱의 noindex, lang을 채운다", async () => {
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(join(dir, "index.html"), `<!doctype html><html data-slidekit="1"><head><title>t</title>
<script type="application/json" id="deck-meta">{"title":"발표 <A>","subtitle":"부제","visibility":"password","lang":"en"}</script></head><body>
<section data-slide="cover"><h1>x</h1></section></body></html>`);
    const r = Bun.spawnSync(["bun", join(root, "bundler", "bundle.ts"), "_bundletest"], { stderr: "pipe" });
    expect(r.stderr.toString()).toBe("");
    const out = await Bun.file(join(root, "dist", "_bundletest.html")).text();
    expect(out).toContain('<html lang="en" data-slidekit="1">');
    expect(out).toContain('rel="icon" href="data:image/svg+xml,');
    expect(out).toContain('property="og:title" content="발표 &lt;A&gt;"');
    expect(out).toContain('name="description" content="부제"');
    expect(out).toContain('name="robots" content="noindex"');
    expect(out).toContain('name="viewport"');
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(join(root, "dist", "_bundletest.html"), { force: true }); }
});

test("저장소 내부(.git, 다른 덱, .env)와 덱 밖을 가리키는 심볼릭 링크는 번들에 넣지 않는다", () => {
  const { symlinkSync } = require("node:fs");
  mkdirSync(dir, { recursive: true });
  try {
    for (const [src, why] of [["../../.git/config", ".git"], ["../demo/index.html", "다른 덱"], ["../../.env", ".env"], ["../../deploy/deploy.ts", "deploy"], ["link.txt", "심볼릭 링크"]] as const) {
      if (src === "link.txt") { try { symlinkSync("/etc/hosts", join(dir, "link.txt")); } catch { /* 이미 있음 */ } }
      writeFileSync(join(dir, "index.html"), `<html data-slidekit="1"><head><title>t</title><script type="application/json" id="deck-meta">{"title":"t"}</script></head><body><section data-slide="cover"><img src="${src}"></section></body></html>`);
      const r = Bun.spawnSync(["bun", join(root, "bundler", "bundle.ts"), "_bundletest"], { stderr: "pipe" });
      expect(r.exitCode, why).not.toBe(0);
      expect(r.stderr.toString(), why).toMatch(/덱 폴더 밖|심볼릭 링크/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(join(root, "dist", "_bundletest.html"), { force: true }); }
});

test("assets/ 안의 이미지(slidekit image가 저장한 경로)를 인라인한다", async () => {
  const d = join(root, "decks", "_bundleassets");
  mkdirSync(join(d, "assets"), { recursive: true });
  try {
    writeFileSync(join(d, "assets", "pic-one.png"), Buffer.from("iVBORw0KGgo=", "base64"));
    writeFileSync(join(d, "index.html"), `<!doctype html><html data-slidekit="1"><head><title>t</title>
<script type="application/json" id="deck-meta">{"title":"t"}</script></head><body>
<section data-slide="cover"><img src="assets/pic-one.png" alt="x"></section><script src="../../engine/slidekit.js"></script></body></html>`);
    const r = Bun.spawnSync(["bun", join(root, "bundler", "bundle.ts"), "_bundleassets"], { stderr: "pipe" });
    expect(r.stderr.toString()).toBe("");
    const out = await Bun.file(join(root, "dist", "_bundleassets.html")).text();
    expect(out).not.toContain("assets/pic-one.png");
    expect(out).toContain("data:image/png;base64");
  } finally { rmSync(d, { recursive: true, force: true }); rmSync(join(root, "dist", "_bundleassets.html"), { force: true }); }
});

test("그라디언트 style 속성(var() 스톱, 슬라이드 배경)은 번들에서 글자 그대로 남는다", async () => {
  const d = join(root, "decks", "_bundlegrad");
  const g1 = "linear-gradient(135deg, var(--sk-accent) 0%, #0b1020 100%)", g2 = "linear-gradient(90deg, rgb(255, 0, 0) 0%, var(--sk-accent) 50%, #00f 100%)";
  mkdirSync(d, { recursive: true });
  try {
    writeFileSync(join(d, "index.html"), `<!doctype html><html data-slidekit="1"><head><title>t</title>
<script type="application/json" id="deck-meta">{"title":"t"}</script></head><body>
<section data-slide="cover" style="background-image: ${g1}"><div style="background-image: ${g2}"></div></section></body></html>`);
    const r = Bun.spawnSync(["bun", join(root, "bundler", "bundle.ts"), "_bundlegrad"], { stderr: "pipe" });
    expect(r.stderr.toString()).toBe("");
    const out = await Bun.file(join(root, "dist", "_bundlegrad.html")).text();
    expect(out).toContain(g1);
    expect(out).toContain(g2);
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(join(root, "dist", "_bundlegrad.html"), { force: true });
  }
});
