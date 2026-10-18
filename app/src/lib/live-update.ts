// 발표 화면 실시간 갱신의 순수 로직(spec/LIVE-UPDATE.md). 파일 파싱, 슬라이드 짝짓기(LCS), 위치 대응, 반영 정책.
// 화면과 네트워크에 닿지 않는다(DOMParser만 쓴다). 엔진에는 이 결과를 `refresh` 메시지로 보낸다.

export type LiveSlide = { fp: string; html: string; text: string };
export type LiveDeck = { slides: LiveSlide[]; styles: string[]; script: string; meta: string; shape: string; legacy: boolean[] };
export type LiveMode = "auto" | "ask" | "off";

// cyrb53: 같은 글자는 같은 값이고 다른 글자가 같은 값일 확률은 무시할 만하다(지문은 DOM 노드를 재사용할지 정하는 데만 쓴다).
export function hashText(s: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

const META_KEYS = ["id", "lang", "pageNumber", "progress"]; // 엔진이 시작할 때만 읽는 메타(바뀌면 새로고침이 필요하다)

/** 덱 원본을 읽는다. 슬라이드가 하나도 없으면 null(읽는 도중의 불완전한 파일이나 깨진 파일). */
export function parseDeck(source: string): LiveDeck | null {
  const doc = new DOMParser().parseFromString(source, "text/html");
  const secs = [...doc.body.children].filter((e) => e.matches("section[data-slide]"));
  if (!secs.length) return null;
  const slides = secs.map((e) => { const html = e.outerHTML; return { fp: hashText(html), html, text: (e.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80) }; });
  const styles = [...doc.head.querySelectorAll("style")].map((s) => s.textContent ?? "");
  const script = hashText([...doc.querySelectorAll("script")].filter((s) => s.id !== "deck-meta" && s.type !== "application/json").map((s) => (s.getAttribute("src") ?? "") + "\n" + (s.textContent ?? "")).join("\u0000"));
  let metaObj: Record<string, unknown> = {};
  try { metaObj = JSON.parse(doc.getElementById("deck-meta")?.textContent ?? "{}") ?? {}; } catch { /* 깨진 메타는 빈 값 */ }
  const meta = hashText(JSON.stringify(META_KEYS.map((k) => metaObj[k] ?? null)));
  // 본문 밖(body 직계의 섹션이 아닌 요소)과 <head>의 나머지(link, meta)가 바뀌면 바꿔 끼울 수 없다.
  const shape = hashText([...doc.body.children].filter((e) => !e.matches("section[data-slide],script")).map((e) => e.outerHTML).join("\u0000") + [...doc.head.children].filter((e) => !e.matches("style,script,title")).map((e) => e.outerHTML).join("\u0000"));
  const legacy = secs.map((e) => e.hasAttribute("data-steps") && !e.querySelector("[data-step],[data-step-out]")); // 옛 규칙(등록한 stepper나 data-steps만)의 슬라이드
  return { slides, styles, script, meta, shape, legacy };
}

/** 두 지문 목록의 최장 공통 부분열. 앞뒤의 같은 부분을 먼저 떼어 내 보통은 아주 작다. 반환은 [옛 번호, 새 번호] 쌍(오름차순, 0부터). */
export function lcsPairs(a: string[], b: string[]): [number, number][] {
  const pairs: [number, number][] = [];
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) { pairs.push([s, s]); s++; }
  let ea = a.length, eb = b.length;
  const tail: [number, number][] = [];
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; tail.push([ea, eb]); }
  const n = ea - s, m = eb - s;
  if (n > 0 && m > 0) {
    if (n * m > 4_000_000) return [...pairs, ...tail.reverse()]; // 터무니없이 큰 덱은 앞뒤만 짝짓는다(나머지는 바뀐 것으로 본다)
    const w = m + 1, t = new Uint16Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i * w + j] = a[s + i] === b[s + j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[s + i] === b[s + j]) { pairs.push([s + i, s + j]); i++; j++; }
      else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) i++;
      else j++;
    }
  }
  return [...pairs, ...tail.reverse()];
}

export type Mapped = { index: number; kept: boolean };
/** 현재 슬라이드(옛 번호, 0부터)가 새 목록의 어디인지. kept는 같은 슬라이드(내용이 고쳐진 경우 포함)로 이어지는지다. 지워졌으면 가장 가까운 남은 슬라이드(앞 이웃 우선). */
export function mapPosition(pairs: [number, number][], oldCount: number, newCount: number, oldIndex: number): Mapped {
  const clamp = (i: number) => Math.max(0, Math.min(newCount - 1, i));
  const hit = pairs.find(([o]) => o === oldIndex);
  if (hit) return { index: clamp(hit[1]), kept: true };
  let po = -1, pn = -1, no = oldCount, nn = newCount;
  for (const [o, n] of pairs) { if (o < oldIndex) { po = o; pn = n; } else { no = o; nn = n; break; } }
  const og = no - po - 1, ng = nn - pn - 1; // 짝 사이의 틈: 옛 쪽 og장이 새 쪽 ng장이 되었다
  if (ng > 0) return { index: clamp(pn + 1 + Math.min(oldIndex - po - 1, ng - 1)), kept: og === ng }; // 같은 수만큼 바뀌었으면 제자리에서 고친 것
  return { index: clamp(pn >= 0 ? pn : nn), kept: false };
}

export type Plan = {
  same: boolean; // 바뀐 것이 없다
  reload: boolean; // 스크립트, 메타, 본문 밖, 옛 규칙 슬라이드가 바뀌어 바꿔 끼울 수 없다
  index: number; kept: boolean; // 새 목록에서의 현재 위치
  changed: number[]; // 새 목록에서 새로 생겼거나 고쳐진 슬라이드(0부터)
  removed: number; // 옛 목록에서 짝이 없는 슬라이드 수
  affectsView: boolean; // 현재 슬라이드, 다음 슬라이드(미리보기), 전역 스타일 중 하나가 바뀐다
  stylesChanged: boolean;
};

export function plan(oldDeck: LiveDeck, next: LiveDeck, oldIndex: number): Plan {
  const of = oldDeck.slides.map((s) => s.fp), nf = next.slides.map((s) => s.fp);
  const pairs = lcsPairs(of, nf), paired = new Set(pairs.map(([, n]) => n)), pairedOld = new Set(pairs.map(([o]) => o));
  const changed = nf.map((_, i) => i).filter((i) => !paired.has(i));
  const stylesChanged = oldDeck.styles.length !== next.styles.length || oldDeck.styles.some((t, i) => t !== next.styles[i]);
  const m = mapPosition(pairs, of.length, nf.length, Math.max(0, Math.min(of.length - 1, oldIndex)));
  const oldNext = of[oldIndex + 1] ?? null, newNext = nf[m.index + 1] ?? null;
  const same = changed.length === 0 && pairs.length === of.length && of.length === nf.length && !stylesChanged && oldDeck.script === next.script && oldDeck.meta === next.meta && oldDeck.shape === next.shape;
  // 옛 규칙(stepper) 슬라이드가 바뀌었거나 새로 생겼으면 새 노드에는 등록된 stepper가 없다
  const legacyTouched = changed.some((i) => next.legacy[i]) || of.some((_, i) => !pairedOld.has(i) && oldDeck.legacy[i]);
  const reload = oldDeck.script !== next.script || oldDeck.meta !== next.meta || oldDeck.shape !== next.shape || legacyTouched;
  const cur = of[oldIndex] ?? null;
  const affectsView = !m.kept || nf[m.index] !== cur || oldNext !== newNext || stylesChanged;
  return { same, reload, index: m.index, kept: m.kept, changed, removed: of.length - pairedOld.size, affectsView, stylesChanged };
}

/** 지금 바로 반영할지(true) 칩으로 물을지(false). 바꿀 수 없는 변경(reload)은 여기서 판단하지 않는다. */
export function shouldAutoApply(mode: LiveMode, p: Plan, audience: boolean): boolean {
  if (mode === "off" || mode === "ask") return false;
  return !p.affectsView || !audience;
}

/** 칩의 문장. 바뀐 슬라이드 번호는 1부터. */
export function chipText(p: Plan, total: number): string {
  if (p.reload) return "Deck code changed";
  const nums = p.changed.slice(0, 3).map((i) => i + 1);
  const more = p.changed.length > 3 ? ` +${p.changed.length - 3}` : "";
  if (p.changed.length) return `Slide ${nums.join(", ")}${more} changed`;
  if (p.removed) return `${p.removed} slide${p.removed === 1 ? "" : "s"} removed`;
  if (p.stylesChanged) return "Deck style changed";
  return `Deck updated (${total} slides)`;
}
