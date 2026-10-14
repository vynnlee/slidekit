# slidekit 배포

1. Cloudflare 대시보드에서 토큰을 만든다(계정 권한: Workers Scripts 편집, Workers KV Storage 편집, Account Settings 읽기. vynnlee.com zone 권한: DNS 편집, Workers Routes 편집, Zone 읽기. 계정 하나와 zone 하나로 범위를 좁힌다). 키체인 저장: `security add-generic-password -a $USER -s slidekit-cloudflare-token -w` (토큰은 프롬프트에 붙여넣기). 토큰 이름은 slidekit-static-deploy이고 2026-10-13에 만들었다.
2. `cd deploy/worker && bunx wrangler kv namespace create DECKS` 결과의 id를 `wrangler.toml`의 `REPLACE_WITH_KV_NAMESPACE_ID`에 넣는다. 토큰은 `export CLOUDFLARE_API_TOKEN=$(security find-generic-password -s slidekit-cloudflare-token -w)`로 셸에 올린다.
3. 쿠키 서명 키 등록: `openssl rand -base64 32 | bunx wrangler secret put COOKIE_SECRET` (deploy/worker에서).
4. vynnlee.com이 Cloudflare DNS에 있으면 Worker 배포 때 `static.vynnlee.com`이 자동 연결된다. 첫 배포: `bun run deploy --worker`
5. 덱 올리기: 번들 후 `bun run deploy <덱>` (비밀번호 덱이면 비밀번호를 물어본다). 주소는 static.vynnlee.com/<덱>.

공개 덱은 올릴 때 `deck-meta`의 `title`도 함께 올라간다. 비밀번호 덱은 인증 전에 제목이 보이므로 `deck-meta`에 `"lockTitle": true`를 적은 경우에만 올린다. 비밀번호는 8자 이상이고, 바꾸면 이미 발급된 쿠키가 모두 무효가 된다. 비밀번호, 잠금(5회 틀리면 15분), 404 안내 페이지는 같은 모양이며 모바일 390px에서도 한 칸 폭을 지킨다. Worker 변경은 `bun run deploy --worker`로 올려야 반영된다.

## Worker 배포 준비와 점검 (2026-10-14, 아직 배포 전)

사용자 승인 뒤에만 `bun run deploy --worker`를 실행한다. 아래는 승인 전에 끝낸 읽기와 드라이런 결과다.

**드라이런**: `cd deploy/worker && bunx wrangler@4.150.0 deploy --dry-run --outdir <임시폴더>`(토큰 없이 됨). 번들 9.0 KiB, gzip 3.9 KiB, 바인딩은 KV `DECKS` 하나. 새 바인딩이나 마이그레이션은 없다.

**지금 배포된 것과의 차이**: 배포된 Worker는 2026-10-13 커밋 `451f134` 시점이다. 이후 `a7715c6`, `a727d33`가 `deploy/worker/src/index.ts`를 바꿨다(57줄 추가, 33줄 삭제). 사용자에게 보이는 변화:
- 비밀번호 덱의 기존 로그인 쿠키가 모두 무효가 된다(서명에 비밀번호 salt를 넣음). 모두 한 번 다시 입력한다. 공개 덱은 영향 없다.
- 비밀번호 덱은 주소창 이동(문서 요청)에만 응답한다. 다른 덱의 스크립트가 `fetch`로 읽으면 403이다. 정상적인 열람은 같다.
- 안내 페이지(비밀번호 폼, 잠금, 404, 설정 오류)가 한 모양으로 통일되고 한국어와 영어로 나온다. 비밀번호 폼은 nonce CSP이며, 덱 제목은 `lockTitle` 옵트인 덱만 보인다.
- 응답 헤더 추가: `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `Strict-Transport-Security`. 공개 덱 캐시는 `public, max-age=60`에서 `public, max-age=0, must-revalidate`로 바뀌어 수정이 바로 보인다.
- GET, HEAD, POST 외 메서드는 405, `Origin: null`이나 깨진 Origin의 POST는 403이다.
- 이미 올린 덱은 다시 올릴 필요가 없다(KV 형식 변경 없음). 새 `title`은 다시 올릴 때부터 meta에 들어간다.

**배포 뒤 점검**: `bun run deploy --smoke [공개덱 [비밀번호덱]]`. GET만 보내며 토큰이 필요 없다. 헤더, 200, 404, 비밀번호 폼, fetch 거부를 확인한다. 지금 배포된 구버전에 실행하면 COOP, HSTS, 캐시 항목이 FAIL로 나오는 것이 정상이고, 배포 뒤에는 모두 PASS여야 한다. 손으로 할 것(시도 횟수를 쓰므로 스크립트에 넣지 않았다): 비밀번호 덱에서 틀린 비밀번호 한 번(401 안내가 뜨는지), 맞는 비밀번호 한 번(덱이 열리고 쿠키가 생기는지). 문제가 있으면 `cd deploy/worker && bunx wrangler@4.150.0 rollback`으로 직전 버전으로 되돌린다(KV 데이터는 그대로다).

**로그인 시도 제한 원자화 선택지**(현재는 KV 읽고 쓰기라 동시 요청과 IP 회전에 뚫린다):
- Durable Object: 덱마다 한 객체가 카운터를 직렬로 처리해 15분 5회를 정확히 지킬 수 있다. 코드는 객체 클래스와 wrangler 마이그레이션 추가로 약 40줄, 요청마다 객체 호출이 한 번 늘어난다. SQLite 기반 객체는 무료 플랜에서도 쓸 수 있고 이 용도의 사용량은 무료 한도(요청 하루 10만 건 수준)에 한참 못 미친다.
- Rate Limiting 바인딩: wrangler 설정 몇 줄과 호출 한 줄이면 되고 무료 플랜에서도 쓸 수 있다. 다만 기간이 10초나 60초 중 하나이고 데이터센터별로 세어 15분 5회를 표현하지 못한다. 거친 1차 방어로만 맞다.
- 추천: Durable Object(덱 이름과 IP를 키로 하는 카운터). 정확도가 요구 사항(15분 5회)과 맞고 비용은 사실상 0이다. 승인 때 이 선택을 함께 묻는다. 위 플랜별 한도 수치는 배포 직전에 Cloudflare 공식 문서로 다시 확인한다.

