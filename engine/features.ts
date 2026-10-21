// 실험 기능 스위치(기본 꺼짐). 배포(Publish, deploy, unpublish, Copy agent prompt)는 v0.1에서 실험 기능이다: 설정 없이는 UI와 API와 명령이 모두 꺼져 있고,
// 켜려면 두 환경 변수가 둘 다 필요하다(deploy/README.md). 서버, 명령, 시험이 같은 함수를 쓴다.
//   SLIDEKIT_EXPERIMENTAL_DEPLOY=1                       배포 기능을 켠다
//   SLIDEKIT_PUBLISH_HOST=https://static.example.com     올린 덱이 놓일 주소(https, 호스트만. 경로와 끝의 /는 없음)

/** 설정된 게시 호스트. 형식이 틀리거나 없으면 빈 문자열. */
export function publishHost(env: Record<string, string | undefined> = process.env): string {
  const h = (env.SLIDEKIT_PUBLISH_HOST ?? "").trim().replace(/\/+$/, "");
  return /^https:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/.test(h) ? h : "";
}

/** 배포 기능이 켜져 있는가: 스위치와 올바른 게시 호스트가 모두 있어야 한다. */
export function deployEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.SLIDEKIT_EXPERIMENTAL_DEPLOY === "1" && publishHost(env) !== "";
}

/** 배포 명령(deploy, unpublish)이 꺼져 있을 때 보여 줄 안내. */
export const DEPLOY_OFF_HELP =
  "Publishing is an experimental feature and is off by default.\nTo use it, set up your own Cloudflare Worker (deploy/README.md), then run with\n  SLIDEKIT_EXPERIMENTAL_DEPLOY=1 SLIDEKIT_PUBLISH_HOST=https://static.your-domain.example";
