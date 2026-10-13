import { expect, test } from "bun:test";
import { readTokens, removeToken, setToken } from "../src/lib/deck-tokens";

const head = (css: string) => `<!doctype html><html><head><title>t</title>\n  <style>\n${css}\n  </style>\n</head><body>\n`;
const A = head(`    /* 토큰 */\n    :root {\n      --sk-accent: #a78bfa; /* 강조 */\n      --my-w: calc(1px + 2px);\n      --u: url("data:image/png;base64,AA;BB");\n    }\n    h1 { color: red; }\n    @media (min-width: 1px) { :root { --sk-accent: #000; } }`);

test("읽기: 최상위 :root만, 값에 ;와 괄호가 있어도 안전", () => {
  expect(readTokens(A)).toEqual({ "--sk-accent": "#a78bfa", "--my-w": "calc(1px + 2px)", "--u": 'url("data:image/png;base64,AA;BB")' });
});
test("있는 변수는 값 글자만 바뀐다", () => {
  const out = setToken(A, "--sk-accent", "#ff0000");
  expect(out).toBe(A.replace("#a78bfa", "#ff0000"));
});
test("없는 변수는 같은 블록 끝에 같은 들여쓰기로 추가", () => {
  const out = setToken(A, "--sk-pad-x", "120px");
  expect(out).toContain('--u: url("data:image/png;base64,AA;BB");\n      --sk-pad-x: 120px;\n    }');
  expect(out.replace("\n      --sk-pad-x: 120px;", "")).toBe(A);
});
test("한 줄 블록과 세미콜론 없는 마지막 선언", () => {
  expect(setToken(head("    :root { --a: 1 }"), "--b", "2")).toContain(":root { --a: 1; --b: 2; }");
  expect(setToken(head("    :root{}"), "--b", "2")).toContain("--b: 2;");
});
test(":root가 없으면 첫 style 끝에 새로 만들고, style이 없으면 head에 만든다", () => {
  const out = setToken(head("    h1 { color: red; }"), "--sk-bg", "#111");
  expect(out).toContain("h1 { color: red; }\n  :root { --sk-bg: #111; }");
  expect(readTokens(out)["--sk-bg"]).toBe("#111");
  const bare = setToken("<html><head><title>t</title></head><body>", "--sk-bg", "#111");
  expect(readTokens(bare)).toEqual({ "--sk-bg": "#111" });
});
test("주석 안의 :root와 style은 무시", () => {
  const c = head("    /* :root { --x: 1; } */\n    p {}") + "<!-- <style>:root{--y:2}</style> -->";
  expect(readTokens(c)).toEqual({});
});
test("지우기와 잘못된 입력 거부", () => {
  expect(readTokens(removeToken(A, "--my-w"))).not.toHaveProperty("--my-w");
  expect(removeToken(A, "--my-w")).not.toContain("--my-w");
  expect(() => setToken(A, "bad", "1")).toThrow();
  expect(() => setToken(A, "--a", "1; x{")).toThrow();
});
test("왕복 안정: 같은 값으로 설정하면 글자가 그대로", () => {
  for (const [k, v] of Object.entries(readTokens(A))) expect(setToken(A, k, v)).toBe(A);
});
