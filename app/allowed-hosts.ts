// 미리보기 프록시가 받는 Host 이름. 로컬 이름은 항상 허용하고, 다른 기기에서 열 주소는 SLIDEKIT_ALLOWED_HOSTS(쉼표로 구분, 포트 없이)로 더한다.
// 예: SLIDEKIT_ALLOWED_HOSTS=my-machine.my-tailnet.ts.net,preview.example.com
export function allowedHosts(env: Record<string, string | undefined> = process.env): Set<string> {
  const extra = (env.SLIDEKIT_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter((h) => /^[a-z0-9.-]+$/.test(h));
  return new Set(["127.0.0.1", "localhost", ...extra]);
}
