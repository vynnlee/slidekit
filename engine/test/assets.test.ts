import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { AssetError, dimensions, safeName, saveAsset, sniff, stripGif, stripJpeg, stripPng, stripWebp, svgProblem } from "../assets";

const dirs: string[] = [];
const deck = () => { const d = mkdtempSync(join(tmpdir(), "sk-asset-")); dirs.push(d); writeFileSync(join(d, "index.html"), "<html></html>"); return d; };
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type: string, data: Uint8Array) => { const t = new TextEncoder().encode(type), out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer); dv.setUint32(0, data.length); out.set(t, 4); out.set(data, 8); dv.setUint32(8 + data.length, crc(out.slice(4, 8 + data.length))); return out; };
const cat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
/** 실제로 열리는 단색 png */
const png = (w: number, h: number, extra: Uint8Array[] = []) => {
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer); dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 2;
  const raw = new Uint8Array((w * 3 + 1) * h);
  return cat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), ...extra, chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array()));
};
/** GPS가 든 EXIF APP1을 가진 최소 jpg(SOF0 포함) */
const GPS_BYTES = [0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09];
const jpgWithGps = () => {
  const tiff = new Uint8Array(8 + 2 + 12 + 4 + 2 + 12 + 4 + 24), dv = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49, 42, 0], 0); dv.setUint32(4, 8, true);
  dv.setUint16(8, 1, true); dv.setUint16(10, 0x8825, true); dv.setUint16(12, 4, true); dv.setUint32(14, 1, true); dv.setUint32(18, 26, true); // GPS IFD 오프셋 26
  dv.setUint32(22, 0, true);
  dv.setUint16(26, 1, true); dv.setUint16(28, 0x0002, true); dv.setUint16(30, 5, true); dv.setUint32(32, 3, true); dv.setUint32(36, 44, true); // 위도 3개 rational = 24바이트, 오프셋 44
  dv.setUint32(40, 0, true);
  tiff.set(GPS_BYTES, 44);
  const exif = cat(new TextEncoder().encode("Exif\0\0"), tiff);
  const app1 = cat(new Uint8Array([0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 0xff]), exif);
  const xmpBody = new TextEncoder().encode("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta GPSLatitude/>");
  const xmp = cat(new Uint8Array([0xff, 0xe1, (xmpBody.length + 2) >> 8, (xmpBody.length + 2) & 0xff]), xmpBody);
  const sof = new Uint8Array([0xff, 0xc0, 0, 11, 8, 0x01, 0x2c, 0x02, 0x58, 1, 1, 0x11, 0]); // 높이 300, 너비 600
  return cat(new Uint8Array([0xff, 0xd8]), app1, xmp, sof, new Uint8Array([0xff, 0xda, 0, 2, 1, 2, 3, 0xff, 0xd9]));
};
const text = (s: string) => new TextEncoder().encode(s);

test("파일명 정리: 경로 구분자 제거, 소문자와 하이픈, 확장자 정규화, 빈 이름은 image", () => {
  expect(safeName("../../My Photo (1).JPEG")).toEqual({ base: "my-photo-1", ext: "jpg" });
  expect(safeName("C:\\x\\y\\Logo__v2.PNG")).toEqual({ base: "logo-v2", ext: "png" });
  expect(safeName("한글.png")).toEqual({ base: "image", ext: "png" });
  expect(safeName("noext")).toEqual({ base: "noext", ext: "" });
  expect(safeName("a".repeat(200) + ".webp").base.length).toBe(60);
  expect(safeName("x.HEIF").ext).toBe("heic");
});
test("매직 바이트와 크기: png, jpg, gif, webp, svg를 알아보고 가로세로를 읽는다", () => {
  expect(sniff(png(10, 5))).toBe("png");
  expect(dimensions(png(10, 5), "png")).toEqual({ width: 10, height: 5 });
  expect(sniff(jpgWithGps())).toBe("jpg");
  expect(dimensions(jpgWithGps(), "jpg")).toEqual({ width: 600, height: 300 });
  expect(sniff(text("GIF89a\x03\x00\x02\x00"))).toBe("gif");
  expect(dimensions(text("GIF89a\x03\x00\x02\x00"), "gif")).toEqual({ width: 3, height: 2 });
  expect(sniff(text('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe("svg");
  expect(sniff(text("<html><script>alert(1)</script>"))).toBeNull();
});
test("저장: assets/ 상대 경로, 충돌하면 -2와 -3, 경로 이탈 이름은 파일명만 쓴다", () => {
  const d = deck();
  const a = saveAsset(d, "../../etc/Pic One.png", png(4, 4));
  expect(a.path).toBe("assets/pic-one.png");
  expect(saveAsset(d, "pic one.png", png(4, 4)).path).toBe("assets/pic-one-2.png");
  expect(saveAsset(d, "Pic-One.PNG", png(4, 4)).path).toBe("assets/pic-one-3.png");
  expect(readdirSync(join(d, "assets")).sort()).toEqual(["pic-one-2.png", "pic-one-3.png", "pic-one.png"]);
  expect(existsSync(join(d, "..", "..", "etc", "pic-one.png"))).toBe(false);
  expect(a.width).toBe(4);
});
test("거부: 허용하지 않는 확장자, 내용과 확장자 불일치(HTML을 png로), 빈 파일, 20MB 초과, 없는 덱", () => {
  const d = deck();
  const err = (f: () => unknown) => { try { f(); } catch (e) { expect(e).toBeInstanceOf(AssetError); return (e as Error).message; } throw new Error("거부되지 않았다"); };
  expect(err(() => saveAsset(d, "run.exe", new Uint8Array([1, 2, 3])))).toContain("쓸 수 없다");
  expect(err(() => saveAsset(d, "x.png", text("<html><script>alert(1)</script></html>")))).toContain("내용이 확장자");
  expect(err(() => saveAsset(d, "x.jpg", png(2, 2)))).toContain("내용이 확장자");
  expect(err(() => saveAsset(d, "x.png", new Uint8Array()))).toContain("빈 파일");
  expect(err(() => saveAsset(d, "x.png", new Uint8Array(20 * 1024 * 1024 + 1)))).toContain("너무 크다");
  expect(err(() => saveAsset(join(d, "nope"), "x.png", png(2, 2)))).toContain("덱 폴더");
  expect(existsSync(join(d, "assets"))).toBe(false);
});
test("svg: 스크립트, on* 속성, javascript:, foreignObject, 엔티티는 거부하고 평범한 svg는 저장", () => {
  expect(svgProblem('<svg><script>1</script></svg>')).toContain("script");
  expect(svgProblem('<svg onload="x()"/>')).toContain("on*");
  expect(svgProblem('<svg><a href="javascript:alert(1)"/></svg>')).toContain("javascript");
  expect(svgProblem('<svg><foreignObject/></svg>')).toContain("foreignObject");
  expect(svgProblem('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg/>')).toContain("엔티티");
  expect(svgProblem('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>')).toBeNull();
  const d = deck();
  expect(() => saveAsset(d, "bad.svg", text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toThrow("스크립트");
  expect(saveAsset(d, "ok.svg", text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>')).path).toBe("assets/ok.svg");
});
test("메타데이터: jpg의 GPS 값과 XMP, png의 텍스트 청크가 저장본에서 사라진다", () => {
  const j = jpgWithGps();
  expect(Buffer.from(j).includes(Buffer.from(GPS_BYTES))).toBe(true);
  const sj = stripJpeg(j);
  expect(Buffer.from(sj).includes(Buffer.from(GPS_BYTES))).toBe(false);
  expect(Buffer.from(sj).toString("latin1")).not.toContain("xmpmeta");
  expect(dimensions(sj, "jpg")).toEqual({ width: 600, height: 300 }); // 나머지는 그대로
  const p = png(3, 3, [chunk("tEXt", text("Comment\0secret location")), chunk("eXIf", new Uint8Array([1, 2, 3]))]);
  expect(Buffer.from(p).toString("latin1")).toContain("secret location");
  const sp = stripPng(p);
  expect(Buffer.from(sp).toString("latin1")).not.toContain("secret location");
  expect(sniff(sp)).toBe("png");
  const d = deck();
  const saved = saveAsset(d, "geo.jpg", j);
  expect(Buffer.from(readFileSync(join(d, saved.path))).includes(Buffer.from(GPS_BYTES))).toBe(false);
});
test("큰 이미지: sips가 없으면 원본을 저장하고 경고만(오류 아님), 큰 용량 경고", () => {
  const d = deck();
  process.env.SLIDEKIT_NO_SIPS = "1";
  try {
    const r = saveAsset(d, "big.png", png(3000, 40), { max: 2400 });
    expect(r.resized).toBe(false);
    expect(r.warnings.join(" ")).toContain("sips가 없거나 실패");
    expect(r.width).toBe(3000);
  } finally { delete process.env.SLIDEKIT_NO_SIPS; }
  const noise = text("<svg xmlns=\"http://www.w3.org/2000/svg\">" + "<!--" + "x".repeat(450 * 1024) + "-->" + "</svg>");
  expect(saveAsset(d, "heavy.svg", noise).warnings.join(" ")).toContain("큰 이미지");
});
test("sips가 있으면 긴 변이 max보다 큰 png를 줄인다", () => {
  if (process.platform !== "darwin" || !Bun.which("sips")) return;
  const d = deck();
  const r = saveAsset(d, "wide.png", png(1200, 100), { max: 600 });
  expect(r.resized).toBe(true);
  expect(Math.max(r.width!, r.height!)).toBeLessThanOrEqual(600);
});
test("assets가 심볼릭 링크이면 거부한다", () => {
  const d = deck(), outside = mkdtempSync(join(tmpdir(), "sk-out-")); dirs.push(outside);
  symlinkSync(outside, join(d, "assets"));
  expect(() => saveAsset(d, "x.png", png(2, 2))).toThrow("심볼릭");
  expect(readdirSync(outside)).toEqual([]);
  mkdirSync(join(d, "ok"));
});

test("heic: sips가 있으면 jpg로 바꿔 저장하고 작은 이미지는 키우지 않는다", () => {
  if (process.platform !== "darwin" || !Bun.which("sips")) return;
  const work = mkdtempSync(join(tmpdir(), "sk-heic-")); dirs.push(work);
  writeFileSync(join(work, "a.png"), png(64, 48));
  const r = Bun.spawnSync(["sips", "-s", "format", "heic", join(work, "a.png"), "--out", join(work, "a.heic")], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0 || !existsSync(join(work, "a.heic"))) return; // 이 기계가 heic 쓰기를 지원하지 않으면 건너뛴다
  const d = deck();
  const s = saveAsset(d, "Photo.HEIC", new Uint8Array(readFileSync(join(work, "a.heic"))));
  expect(s.path).toBe("assets/photo.jpg");
  expect(sniff(new Uint8Array(readFileSync(join(d, s.path))))).toBe("jpg");
  expect(Math.max(s.width!, s.height!)).toBe(64);
  process.env.SLIDEKIT_NO_SIPS = "1";
  try { expect(() => saveAsset(d, "x.heic", new Uint8Array(readFileSync(join(work, "a.heic"))))).toThrow("sips"); } finally { delete process.env.SLIDEKIT_NO_SIPS; }
});

test("svg 우회 시도(보안 감사): 접두사 script, 엔티티로 인코딩한 javascript:, href 애니메이션, 외부 주소, CSS url, 개행 변형", () => {
  const w = (b: string) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:s="http://www.w3.org/2000/svg">${b}</svg>`;
  for (const [name, body] of Object.entries({
    prefixScript: '<s:script>alert(1)</s:script>',
    hexEntity: '<a xlink:href="&#x6A;avascript:alert(1)"><rect width="9" height="9"/></a>',
    decEntityTab: '<a href="java&#9;script:alert(1)"><rect/></a>',
    newlineInScheme: '<a href="java\nscript:alert(1)"><rect/></a>',
    setHref: '<a href="#x"><set attributeName="href" to="javascript:alert(1)"/><rect/></a>',
    animateXlink: '<a><animate attributeName="xlink:href" values="javascript:alert(1)"/><rect/></a>',
    useExternal: '<use xlink:href="https://evil.example/x.svg#a"/>',
    imageExternal: '<image href="http://evil.example/track.png"/>',
    cssUrl: '<style>rect{fill:url(javascript:alert(1))}</style><rect/>',
    cssExternal: '<rect style="fill:url(https://evil.example/x)"/>',
    cssImport: '<style>@import "https://evil.example/x.css";</style>',
    dataHtml: '<image href="data:text/html;base64,PHNjcmlwdD4="/>',
    dataSvg: '<image href="data:image/svg+xml;base64,PHN2Zz4="/>',
    slashOn: '<rect/onload="alert(1)"/>',
    handler: '<handler type="text/javascript">alert(1)</handler>',
  })) expect(svgProblem(w(body)), name).not.toBeNull();
  // 정상 svg는 통과: 그라디언트 #참조, 래스터 data 주소, <a> 링크, 접두사가 붙은 메타데이터 요소
  expect(svgProblem(w('<defs><linearGradient id="g"/></defs><rect fill="url(#g)"/><image href="data:image/png;base64,iVBORw0KGgo="/><a href="https://example.com"><text>링크</text></a><use xlink:href="#g"/><s:metadata>x</s:metadata>'))).toBeNull();
  expect(svgProblem(w("<text>Learn Java Script tips</text>"))).toBeNull();
});

test("보안 감사: webp의 EXIF와 XMP 청크, gif의 주석과 XMP 확장을 지우고 나머지는 그대로, 헤더가 1억 픽셀을 넘으면 거부", () => {
  const le = (n: number) => new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]);
  const rc = (t: string, d: Uint8Array) => cat(text(t), le(d.length), d, d.length & 1 ? new Uint8Array(1) : new Uint8Array());
  const vp8x = new Uint8Array(10); vp8x[0] = 0x0c; // EXIF와 XMP 표시
  const body = cat(text("WEBP"), rc("VP8X", vp8x), rc("EXIF", text("GPS secret")), rc("VP8L", new Uint8Array([0x2f, 0, 0, 0, 0])), rc("XMP ", text("<x:xmpmeta gps/>")));
  const webp = cat(text("RIFF"), le(body.length), body);
  expect(Buffer.from(webp).toString("latin1")).toContain("GPS secret");
  const sw = stripWebp(webp);
  const swt = Buffer.from(sw).toString("latin1");
  expect(swt).not.toContain("GPS secret"); expect(swt).not.toContain("xmpmeta");
  expect(sniff(sw)).toBe("webp");
  expect(new DataView(sw.buffer).getUint32(4, true)).toBe(sw.length - 8);
  expect(sw[20] & 0x0c).toBe(0);
  const gif = cat(text("GIF89a"), new Uint8Array([1, 0, 1, 0, 0x00, 0, 0]), new Uint8Array([0x21, 0xfe, 6]), text("secret"), new Uint8Array([0]), new Uint8Array([0x21, 0xff, 11]), text("XMP DataXMP"), new Uint8Array([3, 1, 2, 3, 0]), new Uint8Array([0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 1, 0]), new Uint8Array([0x3b]));
  const sg = stripGif(gif);
  expect(Buffer.from(sg).toString("latin1")).not.toContain("secret");
  expect(Buffer.from(sg).toString("latin1")).not.toContain("XMP Data");
  expect(sg.length).toBeLessThan(gif.length);
  expect(sg.at(-1)).toBe(0x3b);
  expect(stripGif(text("not a gif"))).toEqual(text("not a gif")); // 읽지 못하면 원본
  const d = deck();
  const hdr = new Uint8Array(13), hv = new DataView(hdr.buffer); hv.setUint32(0, 20000); hv.setUint32(4, 20000); hdr[8] = 8; hdr[9] = 2;
  const bomb = cat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", hdr), chunk("IEND", new Uint8Array())); // 헤더만 있는 가짜: 실제로 풀지 않는다
  expect(() => saveAsset(d, "bomb.png", bomb)).toThrow("너무 크다");
  expect(existsSync(join(d, "assets"))).toBe(false);
});
