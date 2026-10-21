// 시험용 덱(app/test/fixtures/decks)이 깨지지 않았는지: 인라인 스크립트가 구문 오류 없이 파싱되고, 장수와 stepper 구간이 있고, 한글과 개인 이름이 남지 않았다.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (name: string) => readFileSync(join(import.meta.dir, "fixtures", "decks", name, "index.html"), "utf8");
const slides = (h: string) => (h.match(/<section\b[^>]*\bdata-slide\b/g) ?? []).length;

for (const [name, n] of [["sample", 53], ["guide", 26]] as const) {
  test(`${name}: 인라인 스크립트는 구문 오류 없이 파싱된다(글자 치환이 코드를 깨지 않았다)`, () => {
    const h = read(name);
    const scripts = [...h.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => !/\bsrc=|type="application\/json"/.test(m[1]));
    for (const m of scripts) expect(() => new Function(m[2])).not.toThrow();
    for (const m of h.matchAll(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)) expect(() => JSON.parse(m[1])).not.toThrow();
  });
  test(`${name}: ${n}장, 개인 정보 없음`, () => {
    const h = read(name);
    expect(slides(h)).toBe(n);
    expect(h.replace(/\[[^\]\n]*가[^\]\n]*\]/g, "")).not.toMatch(/[가-힣]/); // 정규식의 한글 범위만 남을 수 있다
    expect(h).not.toMatch(/Karpathy|Antigravity|vynnlee|이성빈|Seongbeen/i);
  });
}
test("sample: stepper 슬라이드(data-steps)와 이미지가 있다", () => {
  const h = read("sample");
  expect(h).toContain('id="tok-slide"');
  expect(h).toContain("SlideKit.stepper(");
  expect(h).toMatch(/<img\b/);
  expect(h).toMatch(/data-steps="\d+"/);
});
