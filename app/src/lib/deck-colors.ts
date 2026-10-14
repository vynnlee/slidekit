// 색 선택기 주변 섹션이 쓰는 순수 함수: 덱 토큰 색, 덱에서 쓰는 색, 최근 색, 대비 비율.
// Fluid ColorPicker(수정 금지)와 별개로 필요한 만큼만 직접 해석한다(hex, rgb, hsl, oklch, 이름 색, var()).
import { readTokens } from "@/lib/deck-tokens";

export type Rgba = { r: number; g: number; b: number; a: number }; // r,g,b는 0..255, a는 0..1

const NAMED: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", lime: "#00ff00", blue: "#0000ff", yellow: "#ffff00", cyan: "#00ffff", aqua: "#00ffff",
  magenta: "#ff00ff", fuchsia: "#ff00ff", gray: "#808080", grey: "#808080", silver: "#c0c0c0", maroon: "#800000", olive: "#808000", green: "#008000",
  purple: "#800080", teal: "#008080", navy: "#000080", orange: "#ffa500", pink: "#ffc0cb", gold: "#ffd700", brown: "#a52a2a", indigo: "#4b0082",
  violet: "#ee82ee", coral: "#ff7f50", crimson: "#dc143c", tomato: "#ff6347", salmon: "#fa8072", khaki: "#f0e68c", lavender: "#e6e6fa",
  beige: "#f5f5dc", ivory: "#fffff0", tan: "#d2b48c", turquoise: "#40e0d0", skyblue: "#87ceeb", slategray: "#708090", lightgray: "#d3d3d3",
  lightgrey: "#d3d3d3", darkgray: "#a9a9a9", darkgrey: "#a9a9a9", whitesmoke: "#f5f5f5", gainsboro: "#dcdcdc", rebeccapurple: "#663399",
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const num = (s: string, pct = 1) => (s.endsWith("%") ? (parseFloat(s) / 100) * pct : parseFloat(s));

function oklchToRgb(L: number, C: number, H: number): [number, number, number] {
  const h = (H * Math.PI) / 180, a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return lin.map((v) => { const c = clamp(v, 0, 1); return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)); }) as [number, number, number];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/** CSS 색 글자를 읽는다. 읽지 못하면 null. var()는 resolveVar로 먼저 풀어야 한다. */
export function parseColor(input: string): Rgba | null {
  const s = input.trim().toLowerCase();
  if (s === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  if (NAMED[s]) return parseColor(NAMED[s]);
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join("");
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  const fn = /^(rgba?|hsla?|oklch)\(\s*([^)]*)\)$/.exec(s);
  if (!fn) return null;
  const parts = fn[2].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;
  const a = parts[3] === undefined ? 1 : clamp(num(parts[3]), 0, 1);
  const v = parts.slice(0, 3);
  let rgb: [number, number, number];
  if (fn[1] === "oklch") rgb = oklchToRgb(clamp(num(v[0]), 0, 1), Math.max(0, num(v[1], 0.4)), parseFloat(v[2]) || 0);
  else if (fn[1].startsWith("hsl")) rgb = hslToRgb(((parseFloat(v[0]) % 360) + 360) % 360, clamp(parseFloat(v[1]), 0, 100) / 100, clamp(parseFloat(v[2]), 0, 100) / 100);
  else rgb = v.map((p) => Math.round(clamp(p.endsWith("%") ? (parseFloat(p) / 100) * 255 : parseFloat(p), 0, 255))) as [number, number, number];
  if (rgb.some((n) => Number.isNaN(n)) || Number.isNaN(a)) return null;
  return { r: rgb[0], g: rgb[1], b: rgb[2], a };
}

/** 정규형: 불투명이면 #rrggbb, 아니면 #rrggbbaa(소문자). */
export function toHex(c: Rgba): string {
  const h = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}${c.a < 1 ? h(c.a * 255) : ""}`;
}

/** var(--x)와 var(--x, 대체값)를 토큰으로 풀어 낸다(중첩 허용, 순환은 8단계에서 멈춘다). 풀 수 없으면 null. */
export function resolveVar(value: string, tokens: Record<string, string>, depth = 0): string | null {
  if (depth > 8) return null;
  let failed = false;
  const out = value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g, (_, name: string, fb?: string) => {
    const raw = tokens[name] ?? fb;
    const r = raw === undefined ? null : resolveVar(raw.trim(), tokens, depth + 1);
    if (r === null) { failed = true; return ""; }
    return r;
  });
  return failed ? null : out.trim();
}

/** 토큰 색을 TokensPanel과 같은 짧은 이름으로 돌려준다(덱에 있는 것만). value는 풀린 색(풀 수 없으면 원문). */
const TOKEN_COLORS: [string, string][] = [["--sk-bg", "Page"], ["--sk-fg", "Text"], ["--sk-muted", "Muted"], ["--sk-faint", "Faint"], ["--sk-line", "Line"], ["--sk-panel", "Panel"], ["--sk-accent", "Accent"]];
export function deckTokenColors(html: string): { name: string; label: string; value: string }[] {
  const tokens = readTokens(html);
  return TOKEN_COLORS.filter(([n]) => tokens[n] !== undefined).map(([name, label]) => {
    const r = resolveVar(tokens[name], tokens), c = r === null ? null : parseColor(r);
    return { name, label, value: c ? toHex(c) : tokens[name] };
  });
}

const COLOR_PROP = /(?:^|-)(?:color|background|fill|stroke|border|outline|shadow)(?:-|$)|^caret|^text-decoration/;
const COLOR_TOKEN = /#[0-9a-f]{3,8}\b|(?:rgba?|hsla?|oklch)\([^)]*\)|var\(\s*--[\w-]+\s*(?:,\s*(?:[^()]|\([^()]*\))*)?\)|\b[a-z]+\b/gi;

/** 덱(또는 슬라이드) HTML의 CSS와 인라인 style에서 쓰는 색을 정규화해 많이 쓰는 순서로 최대 16개. :root의 토큰 정의 줄은 세지 않는다. */
export function colorsInDeck(html: string, tokens: Record<string, string> = readTokens(html)): { value: string; count: number }[] {
  const decls: string[] = [];
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) decls.push(...m[1].replace(/\/\*[\s\S]*?\*\//g, "").split(/[;{}]/));
  for (const m of html.matchAll(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) decls.push(...(m[1] ?? m[2]).split(";"));
  const seen = new Map<string, { count: number; order: number }>();
  for (const d of decls) {
    const i = d.indexOf(":");
    if (i < 0) continue;
    const prop = d.slice(0, i).trim().toLowerCase(), val = d.slice(i + 1);
    if (!COLOR_PROP.test(prop) || prop.startsWith("--")) continue;
    for (const t of val.match(COLOR_TOKEN) ?? []) {
      const text = /^var\(/i.test(t) ? resolveVar(t, tokens) : t;
      const c = text === null ? null : parseColor(text);
      if (!c || c.a === 0) continue;
      const k = toHex(c), e = seen.get(k);
      if (e) e.count++; else seen.set(k, { count: 1, order: seen.size });
    }
  }
  return [...seen].sort((a, b) => b[1].count - a[1].count || a[1].order - b[1].order).slice(0, 16).map(([value, e]) => ({ value, count: e.count }));
}

// ---- 최근 색 (localStorage, 12개, 최신순, 중복 제거) ----
const RECENT_KEY = "slidekit:recent-colors";
export function readRecentColors(): string[] {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 12) : []; } catch { return []; }
}
export function pushRecentColor(color: string): string[] {
  const c = parseColor(color);
  if (!c) return readRecentColors();
  const k = toHex(c), next = [k, ...readRecentColors().filter((x) => x !== k)].slice(0, 12);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch {}
  return next;
}

// ---- WCAG 대비 ----
const lin = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (c: Rgba) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
const over = (top: Rgba, bottom: Rgba): Rgba => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });

/** 글자색과 배경색의 대비(1..21). 글자 투명도는 배경에 합성하고, 배경이 투명하면 흰색 위에 있다고 본다. 읽지 못하면 null. */
export function contrastRatio(fg: string, bg: string): number | null {
  const f = parseColor(fg), b = parseColor(bg);
  if (!f || !b) return null;
  const back = over(b, { r: 255, g: 255, b: 255, a: 1 }), top = over(f, back);
  const [hi, lo] = [lum(top), lum(back)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** AA는 4.5(큰 글자 3), AAA는 7(큰 글자 4.5). */
export function wcagLevel(ratio: number, large = false): "AAA" | "AA" | "fail" {
  return ratio >= (large ? 4.5 : 7) ? "AAA" : ratio >= (large ? 3 : 4.5) ? "AA" : "fail";
}
