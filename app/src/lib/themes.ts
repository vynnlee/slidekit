// 덱 테마 프리셋: 색 토큰 일곱 개와 글꼴 쌍을 한 번에 바꾼다(SPEC 4절의 --sk 토큰). 본문 색은 배경과 4.5:1 이상(AA)이다.
export const FONT_SANS = '"Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif';
export const FONT_SERIF = 'Georgia,"Noto Serif KR",serif';
export const FONT_MONO = '"JetBrains Mono",ui-monospace,"SF Mono",Menlo,monospace';

export type Theme = { id: string; label: string; tokens: Record<string, string> };

const t = (id: string, label: string, bg: string, fg: string, muted: string, faint: string, line: string, panel: string, accent: string, font = FONT_SANS): Theme => ({
  id, label,
  tokens: { "--sk-bg": bg, "--sk-fg": fg, "--sk-muted": muted, "--sk-faint": faint, "--sk-line": line, "--sk-panel": panel, "--sk-accent": accent, "--sk-font": font, "--sk-font-mono": FONT_MONO },
});

export const THEMES: Theme[] = [
  t("dark", "Dark", "#000000", "#ffffff", "#9a9a9f", "#5c5c62", "#2b2b30", "#0f0f12", "#a78bfa"),
  t("light", "Light", "#ffffff", "#111113", "#5b5b63", "#8c8c95", "#e3e3e8", "#f4f4f6", "#6d28d9"),
  t("paper", "Paper", "#f6f1e7", "#2b2620", "#665d51", "#8f8677", "#ddd4c2", "#efe8d9", "#a63d1b", FONT_SERIF),
  t("midnight", "Midnight blue", "#0b1220", "#e8eefc", "#9fb0d0", "#5d6f93", "#1e2a44", "#111a2e", "#5eb0ff"),
  t("mono", "Mono", "#0a0a0a", "#f5f5f5", "#a3a3a3", "#666666", "#2a2a2a", "#141414", "#ffffff"),
  t("contrast", "High contrast", "#000000", "#ffffff", "#e0e0e0", "#bdbdbd", "#8a8a8a", "#101010", "#ffd60a"),
];

const norm = (v: string) => v.toLowerCase().replace(/\s+/g, "");
/** 지금 토큰 값이 어느 테마와 모두 같은지(없으면 null = Custom). get은 현재(선언 또는 기본) 값을 돌려준다. */
export function currentTheme(get: (name: string) => string): Theme | null {
  return THEMES.find((th) => Object.entries(th.tokens).every(([k, v]) => norm(get(k)) === norm(v))) ?? null;
}
