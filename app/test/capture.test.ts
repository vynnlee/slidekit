// 영역 코멘트 이미지: 사각형 검증과 자르기 상자, 경로와 쓰기 안전, 보관 상한, 직렬 큐와 한도(가짜 Chrome), 캡처 전용 페이지. 임시 덱 폴더와 가짜 backend만 쓴다(Chrome 실행 없음).
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "sk-capt-test-"));
process.env.SLIDEKIT_DECKS = dir;
const deck = (name: string) => { mkdirSync(join(dir, name), { recursive: true }); writeFileSync(join(dir, name, "index.html"), `<!doctype html><html><head><title>t</title></head><body><section data-slide="cover"><h1>t</h1></section></body></html>`); return join(dir, name); };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const C = await import("../capture");

test("사각형: 0 에서 1, 소수 4자리, 슬라이드 밖은 잘리고, 너무 작거나 이상한 값은 거절", () => {
  expect(C.parseRegion({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 })).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
  expect(C.parseRegion({ x: 0.123456, y: 0, w: 0.5, h: 0.5 })!.x).toBe(0.1235);
  expect(C.parseRegion({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 })).toEqual({ x: 0.9, y: 0.9, w: 0.1, h: 0.1 }); // 밖으로 나간 부분은 자른다
  for (const bad of [null, "x", {}, { x: -0.1, y: 0, w: 0.5, h: 0.5 }, { x: 0, y: 0, w: 0.001, h: 0.5 }, { x: 1.2, y: 0, w: 0.5, h: 0.5 }, { x: "0", y: 0, w: 0.5, h: 0.5 }, { x: NaN, y: 0, w: 0.5, h: 0.5 }, { x: 0.999, y: 0, w: 0.5, h: 0.5 }]) expect(C.parseRegion(bad)).toBeNull();
});
test("자르기 상자는 1920x1080 안의 정수 픽셀이고 최소 1px", () => {
  expect(C.cropBox({ x: 0.5, y: 0.5, w: 0.25, h: 0.25 })).toEqual({ x: 960, y: 540, w: 480, h: 270 });
  const edge = C.cropBox({ x: 0.9999, y: 0.9999, w: 0.005, h: 0.005 });
  expect(edge.x + edge.w).toBeLessThanOrEqual(1920);
  expect(edge.y + edge.h).toBeLessThanOrEqual(1080);
  expect(edge.w).toBeGreaterThanOrEqual(1);
});
test("경로: id 형식이 맞아야 하고 .comments가 심볼릭 링크면 거절, 쓰기는 PNG만 새 파일로", () => {
  const d = deck("paths");
  expect(C.imagePath(d, "../etc", true)).toBeNull();
  expect(C.imagePath(d, "ABCDEFGH", true)).toBeNull();
  expect(C.imagePath(d, "abcdef12")).toBeNull(); // 폴더가 없고 만들지 않음
  expect(C.writeImage(d, "abcdef12", Buffer.from("not a png at all, just text........"))).toBe(false);
  expect(C.writeImage(d, "abcdef12", PNG)).toBe(true);
  expect(existsSync(join(d, ".comments", "abcdef12.png"))).toBe(true);
  expect(C.writeImage(d, "abcdef12", PNG)).toBe(false); // 덮어쓰지 않는다
  expect(C.writeImage(d, "abcdef34", Buffer.concat([PNG, Buffer.alloc(C.MAX_IMAGE_BYTES)]))).toBe(false); // 2MB 상한
  const d2 = deck("linked");
  mkdirSync(join(dir, "outside"), { recursive: true });
  symlinkSync(join(dir, "outside"), join(d2, ".comments"));
  expect(C.imagePath(d2, "abcdef12", true)).toBeNull();
  expect(C.writeImage(d2, "abcdef12", PNG)).toBe(false);
  expect(readdirSync(join(dir, "outside")).length).toBe(0); // 밖에는 아무것도 쓰이지 않았다
});
test("보관 상한: 200개를 넘으면 오래된 것부터 지운다", () => {
  const d = deck("prune");
  mkdirSync(join(d, ".comments"));
  for (let i = 0; i < 205; i++) { const f = join(d, ".comments", `${i.toString(16).padStart(8, "0")}.png`); writeFileSync(f, PNG); utimesSync(f, new Date(2026, 0, 1, 0, 0, i), new Date(2026, 0, 1, 0, 0, i)); }
  C.pruneImages(d);
  const left = readdirSync(join(d, ".comments"));
  expect(left.length).toBe(C.KEEP_FILES);
  expect(left.includes("00000000.png")).toBe(false); // 가장 오래된 것
  expect(left.includes(`${(204).toString(16).padStart(8, "0")}.png`)).toBe(true);
});

// ---- 큐(가짜 Chrome) ----
const fake = (log: string[], delay = 0) => {
  let active = 0, peak = 0;
  C.backend.find = () => "/fake/chrome";
  C.backend.shot = (async ({ url, out }) => { active++; peak = Math.max(peak, active); log.push(url); if (delay) await Bun.sleep(delay); writeFileSync(out, PNG); active--; return true; }) as typeof C.backend.shot;
  C.backend.crop = (async ({ src, dst }) => { writeFileSync(dst, readFileSync(src)); return true; }) as typeof C.backend.crop;
  return () => peak;
};
const job = (d: string, id: string) => ({ deck: d, id, slide: 3, step: 2, region: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 }, port: 3200 });

test("큐: 한 번에 하나씩 순서대로 돌고 PNG가 .comments에 생긴다(주소에 슬라이드와 단계)", async () => {
  deck("q1");
  const log: string[] = [];
  const peak = fake(log, 20);
  const rs = await Promise.all(["00000001", "00000002", "00000003"].map((id) => C.captureImage(job("q1", id))));
  expect(rs).toEqual(["ready", "ready", "ready"]);
  expect(peak()).toBe(1);
  expect(log.length).toBe(3);
  expect(log[0]).toBe("http://127.0.0.1:3200/api/decks/q1/capture-frame?slide=3&step=2#3");
  expect(readdirSync(join(dir, "q1", ".comments")).sort()).toEqual(["00000001.png", "00000002.png", "00000003.png"]);
});
const leftovers = () => readdirSync(tmpdir()).filter((f) => f.startsWith("sk-capture-")).length;
test("실패: Chrome이 없거나, 찍기나 자르기가 실패하거나, 결과가 PNG가 아니면 failed이고 파일이 없다", async () => {
  deck("q2");
  const before = leftovers(); // 다른 실행이 남긴 폴더가 있어도 이 시험이 늘린 개수만 본다
  fake([]);
  C.backend.find = () => null;
  expect(await C.captureImage(job("q2", "00000011"))).toBe("failed");
  C.backend.find = () => "/fake/chrome";
  C.backend.shot = (async () => false) as typeof C.backend.shot;
  expect(await C.captureImage(job("q2", "00000012"))).toBe("failed");
  fake([]);
  C.backend.crop = (async ({ dst }) => { writeFileSync(dst, "not png"); return true; }) as typeof C.backend.crop;
  expect(await C.captureImage(job("q2", "00000013"))).toBe("failed");
  expect(existsSync(join(dir, "q2", ".comments"))).toBe(false);
  expect(leftovers()).toBe(before); // 임시 폴더를 남기지 않는다
});
test("시작 청소: 오래된 sk-capture-* 임시 폴더만 지운다", () => {
  const old = mkdtempSync(join(tmpdir(), "sk-capture-")), fresh = mkdtempSync(join(tmpdir(), "sk-capture-"));
  const t = new Date(Date.now() - 30 * 60_000);
  utimesSync(old, t, t);
  expect(C.sweepStaleTemp()).toBeGreaterThanOrEqual(1);
  expect(existsSync(old)).toBe(false);
  expect(existsSync(fresh)).toBe(true);
  rmSync(fresh, { recursive: true, force: true });
});
test("한도: 큐가 차면(대기 10개) 바로 failed, 취소한 작업은 건너뛴다", async () => {
  deck("q3");
  const log: string[] = [];
  fake(log, 60);
  const ps = Array.from({ length: 14 }, (_, i) => C.captureImage(job("q3", (0x100 + i).toString(16).padStart(8, "0"))));
  C.cancelCapture((0x105).toString(16).padStart(8, "0"));
  const rs = await Promise.all(ps);
  expect(rs.filter((r) => r === "failed").length).toBeGreaterThanOrEqual(3); // 큐 상한 초과분과 취소분
  expect(rs.slice(0, 1)).toEqual(["ready"]);
});

// ---- 캡처 전용 페이지 ----
test("캡처 페이지: base와 전환 끄기와 단계 맞추기 스크립트가 붙고 head나 body가 없어도 동작한다", () => {
  const html = C.frameHtml(`<html><head><title>x</title></head><body><section data-slide="cover"></section></body></html>`, "my-talk", 7, 3);
  expect(html).toContain('<base href="/decks/my-talk/">');
  expect(html).toContain("transition:none!important");
  expect(html).toContain("var N=7,K=3");
  expect(html.indexOf("<script>")).toBeLessThan(html.indexOf("</body>"));
  const bare = C.frameHtml("<p>x</p>", "d", 1, 1);
  expect(bare).toContain("<base");
  expect(bare).toContain("<script>");
});
test("캡처 페이지 경로: 없는 덱 404, 슬라이드와 단계가 이상하면 400", async () => {
  deck("frame");
  const get = (id: string, q: string) => (C.routes["/api/decks/:id/capture-frame"].GET as any)(Object.assign(new Request(`http://x/?${q}`), { params: { id } }));
  expect((await get("nope", "slide=1")).status).toBe(404);
  expect((await get("../x", "slide=1")).status).toBe(404);
  for (const q of ["slide=0", "slide=abc", "slide=1&step=0", "slide=1&step=1000", "slide=1.5"]) expect((await get("frame", q)).status).toBe(400);
  const ok = await get("frame", "slide=2&step=3");
  expect(ok.status).toBe(200);
  expect(await ok.text()).toContain("var N=2,K=3");
});
