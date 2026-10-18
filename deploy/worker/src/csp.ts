// 덱 응답의 Content-Security-Policy(spec/WORKER-CSP.md). 목적은 공개된 덱의 스크립트가 데이터를 밖으로 보내지 못하게 하는 것이다.
// 외부로 나가는 요청(fetch, WebSocket, 폼, 프레임, 워커)은 모두 막고, 덱이 실제로 쓰는 외부 호스트의 이미지, 미디어, 글꼴, 스타일만 연다.
// 호스트 목록은 deploy가 번들에서 뽑아 KV 메타(hosts)로 올린다. Worker는 그 값을 다시 검증한 뒤에만 쓴다(KV가 오염되어도 정책이 느슨해지지 않게).

export const MAX_HOSTS = 20;
// 소문자 호스트 이름만: 와일드카드, 포트, 경로, 스킴, 대문자 없음. 점으로 구분된 두 레이블 이상(localhost와 IP 주소는 허용하지 않는다).
const HOST = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
export const isHost = (h: unknown): h is string => typeof h === "string" && HOST.test(h);

/** 신뢰할 수 없는 값에서 유효한 호스트만 중복 없이 MAX_HOSTS개까지 남긴다(배열이 아니면 빈 목록). */
export function cleanHosts(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const h of v) if (isHost(h) && !out.includes(h)) { out.push(h); if (out.length >= MAX_HOSTS) break; }
  return out;
}

/** 호스트가 없으면 가장 엄격한 정책. hosts는 cleanHosts를 거친 값이어야 한다. */
export function deckCsp(hosts: string[]): string {
  const h = hosts.map((x) => `https://${x}`).join(" ");
  const src = (...base: string[]) => [...base, h].filter(Boolean).join(" ");
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'", // 번들의 엔진과 덱 스크립트가 인라인이다. 목적은 주입 방어가 아니라 유출 차단이다.
    `style-src ${src("'unsafe-inline'")}`,
    `img-src ${src("data:", "blob:")}`,
    `font-src ${src("data:")}`,
    `media-src ${src("data:", "blob:")}`,
    "connect-src 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export const PERMISSIONS = "camera=(), microphone=(), geolocation=(), payment=(), usb=(), display-capture=()";
