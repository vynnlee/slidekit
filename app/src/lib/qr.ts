// 순수 TS QR 생성기(바이트 모드, 오류 정정 M, 버전 1~10 = 최대 213바이트). 의존성 없음.
// 리모컨 주소를 휴대폰 카메라로 읽게 하려는 용도라 이 범위만 구현했다. 구조 검사는 test/qr.test.ts, 실제 디코드 검증은 test/qr-decode.swift.
const EC_M: [number, [number, number][]][] = [ // 버전별: 블록당 EC 코드워드, [블록 수, 블록당 데이터 코드워드] 묶음
  [10, [[1, 16]]], [16, [[1, 28]]], [26, [[1, 44]]], [18, [[2, 32]]], [24, [[2, 43]]],
  [16, [[4, 27]]], [18, [[4, 31]]], [22, [[2, 38], [2, 39]]], [22, [[3, 36], [2, 37]]], [26, [[4, 43], [1, 44]]],
];
export const QR_MAX_BYTES = 213;

const dataCodewords = (v: number) => EC_M[v - 1][1].reduce((n, [b, d]) => n + b * d, 0);
const countBits = (v: number) => (v <= 9 ? 8 : 16);

// GF(256), 0x11D
const mul = (x: number, y: number) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z; };
function rsDivisor(deg: number) {
  const r = new Array<number>(deg).fill(0); r[deg - 1] = 1;
  let root = 1;
  for (let i = 0; i < deg; i++) {
    for (let j = 0; j < r.length; j++) { r[j] = mul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
    root = mul(root, 2);
  }
  return r;
}
export function rsRemainder(data: number[], div: number[]) {
  const r = new Array<number>(div.length).fill(0);
  for (const b of data) { const f = b ^ r.shift()!; r.push(0); div.forEach((c, i) => { r[i] ^= mul(c, f); }); }
  return r;
}

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

/** 글자(UTF-8 바이트)로 QR 행렬을 만든다. true가 어두운 칸. 213바이트를 넘으면 예외. */
export function qrMatrix(text: string): boolean[][] {
  const bytes = [...new TextEncoder().encode(text)];
  let ver = 1;
  while (ver <= 10 && bytes.length * 8 + 4 + countBits(ver) > dataCodewords(ver) * 8) ver++;
  if (ver > 10) throw new Error("QR text too long");

  // 1) 비트열: 모드(0100), 길이, 바이트, 종결자, 바이트 맞춤, 채움 바이트
  const bits: number[] = [];
  const put = (val: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, countBits(ver)); bytes.forEach((b) => put(b, 8));
  const cap = dataCodewords(ver) * 8;
  put(0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));

  // 2) 블록 나누기, 블록마다 Reed-Solomon, 데이터와 EC를 열 순서로 섞기
  const [ecLen, groups] = EC_M[ver - 1];
  const div = rsDivisor(ecLen), blocks: { d: number[]; e: number[] }[] = [];
  let k = 0;
  for (const [n, len] of groups) for (let i = 0; i < n; i++) { const d = data.slice(k, k += len); blocks.push({ d, e: rsRemainder(d, div) }); }
  const all: number[] = [];
  for (let i = 0; i < Math.max(...blocks.map((b) => b.d.length)); i++) for (const b of blocks) if (i < b.d.length) all.push(b.d[i]);
  for (let i = 0; i < ecLen; i++) for (const b of blocks) all.push(b.e[i]);

  // 3) 행렬: 기능 패턴
  const size = ver * 4 + 17;
  const m: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fn: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, v: boolean) => { m[y][x] = v; fn[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const na = ver === 1 ? 0 : Math.floor(ver / 7) + 2;
  const step = na ? Math.ceil((ver * 4 + 4) / (na * 2 - 2)) * 2 : 0;
  const align = na ? [6] : [];
  for (let p = size - 7; align.length < na; p -= step) align.splice(1, 0, p);
  align.forEach((cy, i) => align.forEach((cx, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const format = (mask: number) => {
    const d = (0 << 3) | mask; // 오류 정정 M의 형식 비트는 00
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const b = ((d << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) set(8, i, bit(b, i));
    set(8, 7, bit(b, 6)); set(8, 8, bit(b, 7)); set(7, 8, bit(b, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(b, i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(b, i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(b, i));
    set(8, size - 8, true);
  };
  format(0);
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const b = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) { const a = size - 11 + (i % 3), c = Math.floor(i / 3); set(a, c, bit(b, i)); set(c, a, bit(b, i)); }
  }

  // 4) 데이터 놓기(오른쪽 아래에서 두 칸 폭으로 지그재그)
  let n = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
      if (!fn[y][x] && n < all.length * 8) { m[y][x] = bit(all[n >>> 3], 7 - (n & 7)); n++; }
    }
  }

  // 5) 마스크 8개를 모두 써 보고 감점이 가장 작은 것을 고른다
  const masks = [
    (x: number, y: number) => (x + y) % 2 === 0, (_x: number, y: number) => y % 2 === 0, (x: number) => x % 3 === 0, (x: number, y: number) => (x + y) % 3 === 0,
    (x: number, y: number) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0, (x: number, y: number) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x: number, y: number) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x: number, y: number) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const apply = (mask: number) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && masks[mask](x, y)) m[y][x] = !m[y][x]; };
  let best = 0, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    apply(mask); format(mask);
    const s = penalty(m);
    if (s < bestScore) { bestScore = s; best = mask; }
    apply(mask); // 되돌린다
  }
  apply(best); format(best);
  return m;
}

function penalty(m: boolean[][]) {
  const size = m.length;
  let score = 0, dark = 0;
  const line = (get: (i: number) => boolean) => {
    let run = 1, hist = 0;
    for (let i = 1; i < size; i++) { if (get(i) === get(i - 1)) { run++; if (run === 5) score += 3; else if (run > 5) score++; } else run = 1; }
    // 1:1:3:1:1 모양(앞뒤 흰 칸 4개)
    for (let i = 0; i + 10 < size; i++) {
      const w = (a: number, b: number) => { for (let k = a; k < b; k++) if (get(i + k)) return false; return true; };
      const pat = get(i + 4) && !get(i + 5) && get(i + 6) && get(i + 7) && get(i + 8) && !get(i + 9) && get(i + 10);
      const pat2 = get(i + 0) && !get(i + 1) && get(i + 2) && get(i + 3) && get(i + 4) && !get(i + 5) && get(i + 6);
      if ((pat && w(0, 4)) || (pat2 && w(7, 11))) hist++;
    }
    score += hist * 40;
  };
  for (let y = 0; y < size; y++) { line((i) => m[y][i]); line((i) => m[i][y]); for (let x = 0; x < size; x++) if (m[y][x]) dark++; }
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
  score += Math.floor(Math.abs((dark * 20) / (size * size) - 10)) * 10;
  return score;
}

/** SVG path(어두운 칸을 가로 줄로 묶음). viewBox는 0 0 size size. */
export function qrPath(m: boolean[][]): string {
  let d = "";
  m.forEach((row, y) => { let x = 0; while (x < row.length) { if (!row[x]) { x++; continue; } let e = x; while (e < row.length && row[e]) e++; d += `M${x} ${y}h${e - x}v1h${x - e}z`; x = e; } });
  return d;
}
