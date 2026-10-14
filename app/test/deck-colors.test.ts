import { beforeEach, expect, test } from "bun:test";
import { colorsInDeck, contrastRatio, deckTokenColors, parseColor, pushRecentColor, readRecentColors, resolveVar, toHex, wcagLevel } from "../src/lib/deck-colors";

const deck = (css: string, body = "") => `<html><head><style>:root{--sk-bg:#000;--sk-fg:#fff;--sk-accent:#a78bfa;--sk-alias:var(--sk-accent);--sk-muted:rgba(255,255,255,.5)}${css}</style></head><body>${body}</body></html>`;

test("parseColor: 3자리와 4자리 hex, 8자리 alpha, 이름 색, rgb 공백 문법, hsl, oklch", () => {
  expect(toHex(parseColor("#abc")!)).toBe("#aabbcc");
  expect(parseColor("#abc8")!.a).toBeCloseTo(0x88 / 255, 3);
  expect(toHex(parseColor("#11223380")!)).toBe("#11223380");
  expect(toHex(parseColor("Rebeccapurple")!)).toBe("#663399");
  expect(toHex(parseColor("rgb(10 20 30 / 50%)")!)).toBe("#0a141e80");
  expect(toHex(parseColor("rgb(100%, 0%, 0%)")!)).toBe("#ff0000");
  expect(toHex(parseColor("hsl(120 100% 50%)")!)).toBe("#00ff00");
  expect(toHex(parseColor("oklch(100% 0 0)")!)).toBe("#ffffff");
  expect(parseColor("transparent")!.a).toBe(0);
  expect(parseColor("notacolor")).toBeNull();
  expect(parseColor("#12")).toBeNull();
  expect(parseColor("rgb(1 2)")).toBeNull();
});

test("resolveVar: 토큰, 대체값, 중첩, 순환, 없는 변수", () => {
  const t = { "--a": "#fff", "--b": "var(--a)", "--c": "var(--d)", "--d": "var(--c)" };
  expect(resolveVar("var(--a)", t)).toBe("#fff");
  expect(resolveVar("var(--b)", t)).toBe("#fff");
  expect(resolveVar("var(--nope, #123)", t)).toBe("#123");
  expect(resolveVar("var(--nope, var(--a))", t)).toBe("#fff");
  expect(resolveVar("var(--nope)", t)).toBeNull();
  expect(resolveVar("var(--c)", t)).toBeNull();
  expect(resolveVar("1px solid var(--a)", t)).toBe("1px solid #fff");
});

test("deckTokenColors: TokensPanel과 같은 이름, 덱에 있는 것만, 값은 정규화", () => {
  const r = deckTokenColors(deck(""));
  expect(r.map((x) => x.label)).toEqual(["Page", "Text", "Muted", "Accent"]);
  expect(r.find((x) => x.label === "Page")).toEqual({ name: "--sk-bg", label: "Page", value: "#000000" });
  expect(r.find((x) => x.label === "Muted")!.value).toBe("#ffffff80");
});

test("colorsInDeck: 빈도순, var 해석, 토큰 정의 줄 제외, 투명 제외, 인라인 style, 최대 16개", () => {
  const html = deck(`h1{color:var(--sk-accent)} p{color:var(--sk-alias);background:#A78BFA} .x{border:1px solid red;fill:transparent} .y{color:var(--missing)}`, `<div style="color:#f00; margin:3px; background-color:rgb(0 0 255)">a</div>`);
  const r = colorsInDeck(html);
  expect(r[0]).toEqual({ value: "#a78bfa", count: 3 });
  expect(r.map((x) => x.value)).toContain("#ff0000");
  expect(r.find((x) => x.value === "#ff0000")!.count).toBe(2); // 이름 red + 인라인 #f00
  expect(r.map((x) => x.value)).toContain("#0000ff");
  expect(r.map((x) => x.value)).not.toContain("#000000"); // :root의 --sk-bg 정의는 세지 않는다
  const many = deck(Array.from({ length: 30 }, (_, i) => `.c${i}{color:#${(i + 16).toString(16)}0000}`).join(""));
  expect(colorsInDeck(many).length).toBe(16);
});

test("recentColors: 최신순, 정규화, 중복 제거, 12개 제한, 잘못된 색 무시", () => {
  const store: Record<string, string> = {};
  (globalThis as any).localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } };
  expect(readRecentColors()).toEqual([]);
  pushRecentColor("#F00"); pushRecentColor("blue"); pushRecentColor("#ff0000");
  expect(readRecentColors()).toEqual(["#ff0000", "#0000ff"]);
  pushRecentColor("nope");
  expect(readRecentColors().length).toBe(2);
  for (let i = 0; i < 20; i++) pushRecentColor(`#0000${i.toString(16).padStart(2, "0")}`);
  expect(readRecentColors().length).toBe(12);
  expect(readRecentColors()[0]).toBe("#000013");
});

test("contrastRatio와 wcagLevel: 경계값", () => {
  expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 5);
  expect(contrastRatio("#fff", "#fff")).toBeCloseTo(1, 5);
  expect(contrastRatio("#767676", "#fff")!).toBeGreaterThan(4.5); // AA를 겨우 넘는 회색
  expect(contrastRatio("#777777", "#fff")!).toBeLessThan(4.5);
  // 글자 투명도는 배경에 합성: 흰색 50%를 검정 위에 올리면 회색 #808080과 같다
  expect(contrastRatio("rgba(255,255,255,.5)", "#000")!).toBeCloseTo(contrastRatio("#808080", "#000")!, 1); // 127.5와 128의 반올림 차이만 남는다
  // 투명한 배경은 흰색 위로 본다
  expect(contrastRatio("#000", "transparent")).toBeCloseTo(21, 5);
  expect(contrastRatio("nope", "#fff")).toBeNull();
  expect(wcagLevel(7)).toBe("AAA"); expect(wcagLevel(6.99)).toBe("AA"); expect(wcagLevel(4.5)).toBe("AA"); expect(wcagLevel(4.49)).toBe("fail");
  expect(wcagLevel(4.5, true)).toBe("AAA"); expect(wcagLevel(3, true)).toBe("AA"); expect(wcagLevel(2.99, true)).toBe("fail");
});
