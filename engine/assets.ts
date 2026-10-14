/* 덱 이미지 자산(node 전용). 편집기의 붙여넣기와 끌어다 놓기, 업로드 API, CLI(slidekit image)가 saveAsset 하나로 덱 폴더의 assets/에 저장한다.
   - 파일명은 소문자, 숫자, 하이픈만 쓰고 충돌하면 -2, -3을 붙인다. 확장자는 png, jpg, webp, gif, svg(heic는 sips가 있으면 jpg로 바꿔 저장).
   - 내용 앞부분(매직 바이트)이 확장자와 맞아야 하고, svg는 스크립트가 될 수 있는 것을 거부한다.
   - jpg의 GPS 위치정보와 XMP, png의 텍스트 메타데이터는 항상 지운다(순수 코드). 방향 정보 등 나머지 EXIF는 둔다.
   - macOS sips가 있으면 긴 변이 max를 넘는 png, jpg를 줄인다. 없으면 원본을 저장하고 경고만 한다(오류가 아니다).
   덱 이름 검증은 호출하는 쪽(app/folder.ts의 deckFolder, CLI)이 하고 여기서는 이미 검증된 덱 폴더 경로를 받는다. */
import { closeSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join, sep } from "node:path";

export const MAX_BYTES = 20 * 1024 * 1024;
export const DEFAULT_MAX = 2400;
export const LARGE_BYTES = 400 * 1024; // 번들러의 큰 이미지 경고와 같은 기준
export type SavedAsset = { path: string; bytes: number; width?: number; height?: number; resized: boolean; warnings: string[] };

export class AssetError extends Error {}
const fail = (m: string): never => { throw new AssetError(m); };

/** 파일명 정리: 경로 구분자를 버리고 소문자, 숫자, 하이픈만 남긴다. 확장자는 따로 돌려준다(jpeg는 jpg로). */
export function safeName(name: string): { base: string; ext: string } {
  const file = basename(name.replace(/\\/g, "/"));
  const ext0 = extname(file).slice(1).toLowerCase();
  const ext = ext0 === "jpeg" ? "jpg" : ext0 === "heif" ? "heic" : ext0;
  const stem = file.slice(0, file.length - (ext0 ? ext0.length + 1 : 0));
  const base = stem.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "image";
  return { base, ext };
}

const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.slice(at, at + n));
/** 내용의 종류를 매직 바이트로 알아낸다. 모르면 null */
export function sniff(b: Uint8Array): "png" | "jpg" | "gif" | "webp" | "heic" | "svg" | null {
  if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (starts(b, [0xff, 0xd8, 0xff])) return "jpg";
  if (ascii(b, 0, 4) === "GIF8") return "gif";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
  if (ascii(b, 4, 4) === "ftyp" && /^(heic|heix|hevc|hevx|mif1|msf1|heim|heis)$/.test(ascii(b, 8, 4))) return "heic";
  const head = new TextDecoder().decode(b.slice(0, 2048)).replace(/^﻿/, "").trimStart();
  if (/^(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return "svg";
  return null;
}

/** svg에서 스크립트가 될 수 있는 것을 찾는다. 있으면 이유를 돌려준다. */
export function svgProblem(text: string): string | null {
  if (/<script\b/i.test(text)) return "<script>가 들어 있다";
  if (/\son[a-z]+\s*=/i.test(text)) return "on* 이벤트 속성이 들어 있다";
  if (/javascript\s*:/i.test(text)) return "javascript: 주소가 들어 있다";
  if (/data\s*:\s*text\/html/i.test(text)) return "data:text/html 주소가 들어 있다";
  if (/<(foreignObject|iframe|embed|object)\b/i.test(text)) return "foreignObject, iframe, embed, object 요소가 들어 있다";
  if (/<!ENTITY/i.test(text)) return "외부 엔티티 선언이 들어 있다";
  return null;
}

/** 가로세로 픽셀. 알 수 없으면 undefined */
export function dimensions(b: Uint8Array, kind: string): { width: number; height: number } | undefined {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    if (kind === "png") return { width: dv.getUint32(16), height: dv.getUint32(20) };
    if (kind === "gif") return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
    if (kind === "jpg") {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
        i += 2 + dv.getUint16(i + 2);
      }
    }
    if (kind === "webp") {
      const t = ascii(b, 12, 4);
      if (t === "VP8X") return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
      if (t === "VP8 ") return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
      if (t === "VP8L") { const v = dv.getUint32(21, true); return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
    }
  } catch { /* 깨진 파일은 크기를 모른다 */ }
  return undefined;
}

/** jpg에서 GPS 정보(EXIF의 GPS IFD)를 0으로 지우고 XMP 세그먼트를 뺀다. 방향 같은 나머지 EXIF는 둔다. */
export function stripJpeg(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [b.slice(0, 2)];
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const m = b[i + 1];
    if (m === 0xda || m === 0xd9) break; // 이미지 데이터 시작
    const len = (b[i + 2] << 8) | b[i + 3];
    const seg = b.slice(i, i + 2 + len);
    const id = ascii(seg, 4, 29);
    if (m === 0xe1 && id.startsWith("http://ns.adobe.com/xap/1.0/")) { i += 2 + len; continue; } // XMP 통째로 삭제
    if (m === 0xe1 && ascii(seg, 4, 4) === "Exif") zeroGps(seg);
    parts.push(seg);
    i += 2 + len;
  }
  parts.push(b.slice(i));
  const total = parts.reduce((n, p) => n + p.length, 0), res = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { res.set(p, o); o += p.length; }
  return res;
}
function zeroGps(seg: Uint8Array) {
  const tiff = 10; // 마커 2 + 길이 2 + "Exif\0\0" 6
  if (seg.length < tiff + 8) return;
  const little = ascii(seg, tiff, 2) === "II";
  const dv = new DataView(seg.buffer, seg.byteOffset, seg.byteLength);
  const u16 = (o: number) => dv.getUint16(o, little), u32 = (o: number) => dv.getUint32(o, little);
  try {
    const ifd0 = tiff + u32(tiff + 4), n = u16(ifd0);
    for (let k = 0; k < n; k++) {
      const e = ifd0 + 2 + k * 12;
      if (u16(e) !== 0x8825) continue;
      const gps = tiff + u32(e + 8), gn = u16(gps), SZ = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];
      for (let g = 0; g < gn; g++) {
        const ge = gps + 2 + g * 12, size = (SZ[u16(ge + 2)] ?? 1) * u32(ge + 4);
        if (size > 4) { const at = tiff + u32(ge + 8); if (at + size <= seg.length) seg.fill(0, at, at + size); }
      }
      seg.fill(0, gps, Math.min(seg.length, gps + 2 + gn * 12 + 4)); // 항목 표도 0으로: 개수 0인 빈 IFD가 된다
    }
  } catch { /* 깨진 EXIF는 건드리지 않는다 */ }
}

/** png에서 텍스트와 EXIF 메타데이터 청크를 뺀다(eXIf, tEXt, zTXt, iTXt). */
export function stripPng(b: Uint8Array): Uint8Array {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), parts: Uint8Array[] = [b.slice(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = dv.getUint32(i), type = ascii(b, i + 4, 4), end = i + 12 + len;
    if (end > b.length) { parts.push(b.slice(i)); i = b.length; break; }
    if (!["eXIf", "tEXt", "zTXt", "iTXt"].includes(type)) parts.push(b.slice(i, end));
    i = end;
  }
  const res = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { res.set(p, o); o += p.length; }
  return res;
}

const hasSips = () => process.platform === "darwin" && !process.env.SLIDEKIT_NO_SIPS && !!Bun.which("sips"); // SLIDEKIT_NO_SIPS=1은 sips가 없는 환경을 시험하는 용도
/** sips로 변환하고 줄인다(heic를 jpg로, 긴 변이 max보다 크면 축소). 실패하면 null */
function sips(bytes: Uint8Array, kind: "png" | "jpg" | "heic", max: number): Uint8Array | null {
  const work = mkdtempSync(join(tmpdir(), "slidekit-img-"));
  try {
    const src = join(work, `in.${kind === "heic" ? "heic" : kind}`), dst = join(work, `out.${kind === "png" ? "png" : "jpg"}`);
    writeFileSync(src, bytes);
    // -Z는 작은 이미지도 키우므로, 이미 max 이하이면 크기 옵션을 주지 않는다(heic 변환만 한다).
    let zoom = kind !== "heic";
    if (kind === "heic") {
      const g = Bun.spawnSync(["sips", "-g", "pixelWidth", "-g", "pixelHeight", src], { stdout: "pipe", stderr: "pipe" }).stdout.toString();
      const w = Number(g.match(/pixelWidth:\s*(\d+)/)?.[1]), h = Number(g.match(/pixelHeight:\s*(\d+)/)?.[1]);
      zoom = !(w && h) || Math.max(w, h) > max;
    }
    const r = Bun.spawnSync(["sips", ...(kind === "heic" ? ["-s", "format", "jpeg", "-s", "formatOptions", "85"] : []), ...(zoom ? ["-Z", String(max)] : []), src, "--out", dst], { stdout: "pipe", stderr: "pipe" });
    return r.exitCode === 0 && existsSync(dst) ? new Uint8Array(readFileSync(dst)) : null;
  } finally { rmSync(work, { recursive: true, force: true }); }
}

/** 덱 폴더의 assets/에 이미지를 저장한다. name은 원래 파일명(확장자 판단용), 반환 path는 덱 기준 상대 경로(assets/foo.jpg). */
export function saveAsset(deckDir: string, name: string, bytes: Uint8Array, opts: { max?: number } = {}): SavedAsset {
  const max = Math.max(200, Math.min(opts.max ?? DEFAULT_MAX, 10000));
  if (!bytes.length) fail("빈 파일이다");
  if (bytes.length > MAX_BYTES) fail(`파일이 너무 크다(${(bytes.length / 1024 / 1024).toFixed(1)} MB). ${MAX_BYTES / 1024 / 1024} MB 이하로 줄인다`);
  let st; try { st = statSync(deckDir); } catch { return fail("덱 폴더가 없다"); }
  if (!st.isDirectory()) fail("덱 폴더가 아니다");

  const { base, ext } = safeName(name);
  if (!["png", "jpg", "webp", "gif", "svg", "heic"].includes(ext)) fail(`이 형식은 쓸 수 없다(.${ext || "확장자 없음"}). png, jpg, webp, gif, svg만 된다`);
  const kind = sniff(bytes);
  if (kind !== ext) fail(`파일 내용이 확장자(.${ext})와 다르다${kind ? `(내용은 ${kind})` : ""}`);

  const warnings: string[] = [];
  let data = bytes, outExt = ext, resized = false;
  if (kind === "svg") {
    const why = svgProblem(new TextDecoder().decode(bytes));
    if (why) fail(`svg를 저장하지 않는다: ${why}. 스크립트가 있는 svg는 열 때 코드가 실행될 수 있다`);
  } else if (kind === "heic") {
    if (!hasSips()) fail("heic는 macOS sips가 있어야 jpg로 바꿀 수 있다. 사진 앱에서 jpg로 내보낸 파일을 쓴다");
    const j = sips(bytes, "heic", max);
    if (!j) fail("heic를 jpg로 바꾸지 못했다");
    data = j!; outExt = "jpg"; resized = true;
  } else if (kind === "png" || kind === "jpg") {
    const d = dimensions(bytes, kind);
    if (d && Math.max(d.width, d.height) > max) {
      const s = hasSips() ? sips(bytes, kind, max) : null;
      if (s) { data = s; resized = true; }
      else warnings.push(`가로세로 ${d.width}x${d.height}가 ${max}보다 커서 줄이고 싶지만 sips가 없거나 실패해 원본을 저장했다`);
    }
  }
  if (outExt === "jpg") data = stripJpeg(data); else if (outExt === "png") data = stripPng(data);
  if (data.length > LARGE_BYTES) warnings.push(`큰 이미지(${(data.length / 1024).toFixed(0)} KB). 번들과 배포가 무거워진다. 더 줄이면 열리는 속도가 빨라진다`);

  const dir = join(deckDir, "assets");
  if (existsSync(dir)) { if (lstatSync(dir).isSymbolicLink() || !lstatSync(dir).isDirectory()) fail("assets가 폴더가 아니거나 심볼릭 링크다"); }
  else mkdirSync(dir, { mode: 0o755 });
  const realDir = realpathSync(dir), realDeck = realpathSync(deckDir);
  if (!realDir.startsWith(realDeck + sep)) fail("assets 폴더가 덱 폴더 밖이다");

  for (let n = 1; n < 1000; n++) {
    const file = `${n === 1 ? base : `${base}-${n}`}.${outExt}`, full = join(realDir, file);
    let fd: number;
    try { fd = openSync(full, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "EEXIST") continue; throw e; }
    try { writeFileSync(fd, data); } finally { closeSync(fd); }
    const dim = dimensions(data, outExt);
    return { path: `assets/${file}`, bytes: data.length, ...(dim ?? {}), resized, warnings };
  }
  return fail("같은 이름이 너무 많다");
}
