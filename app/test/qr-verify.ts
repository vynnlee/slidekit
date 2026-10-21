// lib/qr.ts의 출력을 macOS CoreImage로 실제로 디코드해 확인한다(수동 도구, 러너 단계 아님). 사용: bun app/test/qr-verify.ts
import { qrMatrix } from "../src/lib/qr";
import { tmpdir } from "node:os";
import { join } from "node:path";

const texts = [
  "A", "https://example.com/", "https://box.example.ts.net:3243/remote/slidekit-guide#code=ABCDEFGH",
  "https://box.example.ts.net:3243/remote/" + "x".repeat(60) + "#code=ABCDEFGH", // 버전 7 이상(버전 정보 비트)
  "https://box.example.ts.net:3243/remote/" + "y".repeat(140) + "#code=ABCDEFGH", // 버전 9 이상
  "z".repeat(213), "리모컨 한글 주소 ✓",
];
const cases = texts.map((text) => ({ text, rows: qrMatrix(text).map((r) => r.map((b) => (b ? "1" : "0")).join("")) }));
const file = join(tmpdir(), `qr-cases-${process.pid}.json`);
await Bun.write(file, JSON.stringify(cases));
const p = Bun.spawnSync(["swift", join(import.meta.dir, "qr-decode.swift"), file], { stdout: "inherit", stderr: "inherit" });
process.exit(p.exitCode ?? 1);
