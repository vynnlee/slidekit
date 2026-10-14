import { expect, test } from "bun:test";
import { qrMatrix, qrPath, rsRemainder } from "../src/lib/qr";

const versionOf = (m: boolean[][]) => (m.length - 17) / 4;

test("크기: 글자 수에 따라 버전이 올라가고 213바이트가 한계", () => {
  expect(versionOf(qrMatrix("A"))).toBe(1);
  expect(versionOf(qrMatrix("x".repeat(14)))).toBe(1); // 버전 1 M의 바이트 용량 14
  expect(versionOf(qrMatrix("x".repeat(15)))).toBe(2);
  expect(versionOf(qrMatrix("x".repeat(84)))).toBe(5);
  expect(versionOf(qrMatrix("x".repeat(85)))).toBe(6);
  expect(versionOf(qrMatrix("x".repeat(213)))).toBe(10);
  expect(() => qrMatrix("x".repeat(214))).toThrow();
});

test("기능 패턴: 찾기 무늬 3개, 타이밍 줄, 항상 어두운 칸", () => {
  const m = qrMatrix("https://example.com/remote/abc#code=ABCDEFGH");
  const n = m.length;
  const finder = (x: number, y: number) => { for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 7; dx++) { const edge = dx === 0 || dx === 6 || dy === 0 || dy === 6, core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4; if (m[y + dy][x + dx] !== (edge || core)) return false; } return true; };
  expect(finder(0, 0) && finder(n - 7, 0) && finder(0, n - 7)).toBe(true);
  for (let i = 8; i < n - 8; i++) { expect(m[6][i]).toBe(i % 2 === 0); expect(m[i][6]).toBe(i % 2 === 0); }
  expect(m[n - 8][8]).toBe(true);
});

test("형식 정보: 두 사본이 같고 BCH가 맞다(마스크 번호를 복원)", () => {
  for (const t of ["a", "hello world", "x".repeat(100), "한글"]) {
    const m = qrMatrix(t), n = m.length;
    const b1 = [0, 1, 2, 3, 4, 5].map((i) => m[i][8]).concat([m[7][8], m[8][8], m[8][7]], [9, 10, 11, 12, 13, 14].map((i) => m[8][14 - i]));
    const b2 = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => m[8][n - 1 - i]).concat([8, 9, 10, 11, 12, 13, 14].map((i) => m[n - 15 + i][8]));
    expect(b1).toEqual(b2);
    const v = b1.reduce((a, bit, i) => a | ((bit ? 1 : 0) << i), 0) ^ 0x5412;
    let rem = v; for (let i = 14; i >= 10; i--) if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
    expect(rem).toBe(0);
    expect(v >>> 13).toBe(0); // 오류 정정 M = 00
  }
});

test("Reed-Solomon: 알려진 예(ISO 18004 부록 I의 01234567 버전 1-M)와 일치", () => {
  // 데이터 코드워드 16개, EC 10개. 값은 ISO/IEC 18004 부록 I의 예시.
  const data = [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11];
  const div = (() => { const r = new Array(10).fill(0); r[9] = 1; let root = 1; const mul = (x: number, y: number) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z; }; for (let i = 0; i < 10; i++) { for (let j = 0; j < 10; j++) { r[j] = mul(r[j], root); if (j + 1 < 10) r[j] ^= r[j + 1]; } root = mul(root, 2); } return r; })();
  expect(rsRemainder(data, div)).toEqual([0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]);
});

test("qrPath: 어두운 칸 수만큼 면적을 덮는다", () => {
  const m = qrMatrix("hi");
  const area = [...qrPath(m).matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)].reduce((s, r) => s + Number(r[3]), 0);
  expect(area).toBe(m.flat().filter(Boolean).length);
});
