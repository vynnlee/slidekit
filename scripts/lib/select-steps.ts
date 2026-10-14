// `bun run test --only <이름>`의 단계 선택 규칙 한 곳. 정확히 일치하는 이름만 고르는 것이 기본이다.
//   - 이름 하나: 정확 일치(`editor`는 editor 단계 하나)
//   - 글로브: `editor*`, `*-e2e` 처럼 *가 들어 있으면 패턴 일치
//   - 그룹 별칭: 아래 ALIASES에 있는 이름은 여러 단계로 풀린다(`unit`, `channel`, `ux-shots`, `bundler`)
//   - 맞는 단계가 없으면 비슷한 이름을 알려 준다
export const ALIASES: Record<string, string[]> = {
  unit: ["unit-other", "unit-isolated"],
  channel: ["channel", "channel-resilience", "channel-trust"],
  "ux-shots": ["ux-shots-1440", "ux-shots-390"],
  bundler: ["bundler-bundle", "bundler-fonts", "bundler-fonts-e2e"],
};

const globRe = (g: string) => new RegExp("^" + g.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");

/** names: 전체 단계 이름, only: --only 값들. 선택된 이름과 맞는 게 없는 요청, 비슷한 이름 힌트를 돌려준다. */
export function selectSteps(names: string[], only: string[]): { picked: string[]; missing: { ask: string; similar: string[] }[] } {
  const picked = new Set<string>(), missing: { ask: string; similar: string[] }[] = [];
  for (const o of only) {
    const exact = o.startsWith("\u0000"); // --changed가 넘기는 정확 일치 표시
    const ask = exact ? o.slice(1) : o;
    let hit: string[];
    if (exact) hit = names.filter((n) => n === ask);
    else if (ask.includes("*")) { const re = globRe(ask); hit = names.filter((n) => re.test(n)); }
    else if (ask in ALIASES) hit = ALIASES[ask].filter((n) => names.includes(n));
    else if (names.includes(ask)) hit = [ask];
    else hit = [];
    if (!hit.length) missing.push({ ask, similar: names.filter((n) => n.includes(ask) || ask.includes(n)) });
    for (const n of hit) picked.add(n);
  }
  return { picked: names.filter((n) => picked.has(n)), missing };
}
