# slidekit 배포

1. Cloudflare 대시보드에서 토큰을 만든다(계정 권한: Workers Scripts 편집, Workers KV Storage 편집, Account Settings 읽기. vynnlee.com zone 권한: DNS 편집, Workers Routes 편집, Zone 읽기. 계정 하나와 zone 하나로 범위를 좁힌다). 키체인 저장: `security add-generic-password -a $USER -s slidekit-cloudflare-token -w` (토큰은 프롬프트에 붙여넣기). 토큰 이름은 slidekit-static-deploy이고 2026-10-13에 만들었다.
2. `cd deploy/worker && bunx wrangler kv namespace create DECKS` 결과의 id를 `wrangler.toml`의 `REPLACE_WITH_KV_NAMESPACE_ID`에 넣는다. 토큰은 `export CLOUDFLARE_API_TOKEN=$(security find-generic-password -s slidekit-cloudflare-token -w)`로 셸에 올린다.
3. 쿠키 서명 키 등록: `openssl rand -base64 32 | bunx wrangler secret put COOKIE_SECRET` (deploy/worker에서).
4. vynnlee.com이 Cloudflare DNS에 있으면 Worker 배포 때 `static.vynnlee.com`이 자동 연결된다. 첫 배포: `bun run deploy --worker`
5. 덱 올리기: 번들 후 `bun run deploy <덱>` (비밀번호 덱이면 비밀번호를 물어본다). 주소는 static.vynnlee.com/<덱>.

공개 덱은 올릴 때 `deck-meta`의 `title`도 함께 올라간다. 비밀번호 덱은 인증 전에 제목이 보이므로 `deck-meta`에 `"lockTitle": true`를 적은 경우에만 올린다. 비밀번호는 8자 이상이고, 바꾸면 이미 발급된 쿠키가 모두 무효가 된다. 비밀번호, 잠금(5회 틀리면 15분), 404 안내 페이지는 같은 모양이며 모바일 390px에서도 한 칸 폭을 지킨다. Worker 변경은 `bun run deploy --worker`로 올려야 반영된다.

## Worker 배포 준비와 점검 (2026-10-14 작성, 2026-10-15 재확인, 아직 배포 전)

사용자 승인 뒤에만 `bun run deploy --worker`를 실행한다. 아래는 승인 전에 끝낸 읽기와 드라이런 결과다.

**드라이런**: `cd deploy/worker && bunx wrangler@4.150.0 deploy --dry-run --outdir <임시폴더>`(토큰 없이 됨). 번들 9.0 KiB, gzip 3.9 KiB, 바인딩은 KV `DECKS` 하나. 새 바인딩이나 마이그레이션은 없다.

**지금 배포된 것과의 차이**: 배포된 Worker는 2026-10-13 커밋 `451f134` 시점이다. 이후 `a7715c6`, `a727d33`가 `deploy/worker/src/index.ts`를 바꿨다(57줄 추가, 33줄 삭제). 사용자에게 보이는 변화:
- 비밀번호 덱의 기존 로그인 쿠키가 모두 무효가 된다(서명에 비밀번호 salt를 넣음). 모두 한 번 다시 입력한다. 공개 덱은 영향 없다.
- 비밀번호 덱은 주소창 이동(문서 요청)에만 응답한다. 다른 덱의 스크립트가 `fetch`로 읽으면 403이다. 정상적인 열람은 같다.
- 안내 페이지(비밀번호 폼, 잠금, 404, 설정 오류)가 한 모양으로 통일되고 한국어와 영어로 나온다. 비밀번호 폼은 nonce CSP이며, 덱 제목은 `lockTitle` 옵트인 덱만 보인다.
- 응답 헤더 추가: `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `Strict-Transport-Security`. 공개 덱 캐시는 `public, max-age=60`에서 `public, max-age=0, must-revalidate`로 바뀌어 수정이 바로 보인다.
- GET, HEAD, POST 외 메서드는 405, `Origin: null`이나 깨진 Origin의 POST는 403이다.
- 이미 올린 덱은 다시 올릴 필요가 없다(KV 형식 변경 없음). 새 `title`은 다시 올릴 때부터 meta에 들어간다.

**배포 뒤 점검**: `bun run deploy --smoke [공개덱 [비밀번호덱]]`. GET만 보내며 토큰이 필요 없다. 공개 덱과 없는 덱 응답의 보안 헤더(nosniff, COOP, HSTS, frame-ancestors none, noindex), 공개 덱 200과 캐시 `must-revalidate`, 슬라이드 HTML, 없는 덱 404, 비밀번호 덱의 폼(슬라이드 없음, nonce CSP, no-store)과 문서가 아닌 요청 403을 확인한다. 지금 배포된 구버전에 실행하면 COOP, HSTS, 캐시 항목이 FAIL로 나오는 것이 정상이고, 배포 뒤에는 모두 PASS여야 한다. 손으로 할 것(시도 횟수를 쓰므로 스크립트에 넣지 않았다): 비밀번호 덱에서 틀린 비밀번호 한 번(401 안내가 뜨는지), 맞는 비밀번호 한 번(덱이 열리고 쿠키가 생기는지). 문제가 있으면 `cd deploy/worker && bunx wrangler@4.150.0 rollback`으로 직전 버전으로 되돌린다(KV 데이터는 그대로다).

**로그인 시도 제한(구현 완료, 미배포)**: Durable Object `Limiter`(SQLite 기반)가 덱과 IP를 키로 시도를 세고, 검사와 증가를 한 번에 해서 동시 요청이 5번을 넘기지 못한다(15분 창에서 5회, 맞으면 지움, 창이 끝나면 알람으로 저장소를 비움). `LIMITER` 바인딩이 없으면 이전과 같은 KV 카운터로 동작해 구버전 배포와도 호환된다. 단위 테스트가 동시 요청 30개 중 정확히 5개만 비밀번호를 시험함을 보이고, 같은 조건에서 KV 폴백이 5개를 넘기는 것도 보인다. `wrangler.toml`에 바인딩과 마이그레이션 `v1`(`new_sqlite_classes`)이 있고 `--dry-run`이 통과한다(번들 10.6 KiB, gzip 4.4 KiB, 바인딩 LIMITER와 DECKS). 마이그레이션 적용 자체는 드라이런으로 검증할 수 없고 첫 실제 배포에서 일어난다.

선택지 비교(공식 문서로 확인한 수치):
- Durable Object: 무료 플랜은 SQLite 기반만 쓸 수 있고, 하루 요청 100,000건, 기간 13,000 GB-s, 행 읽기 500만, 행 쓰기 100,000, SQL 저장 5 GB(합계) 한도다. 이 용도(시도 한 번에 쓰기 두세 행)는 한도에 한참 못 미친다. https://developers.cloudflare.com/durable-objects/platform/pricing/
- Rate Limiting 바인딩: 기간이 10초 또는 60초뿐이고 데이터센터별 집계이며 비동기로 동기화되어 허용 쪽으로 느슨하다. 15분 5회를 표현하지 못한다. 요금제 조건은 문서에 없다. https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- 결론: Durable Object를 쓴다(구현함).

**승인 시 실행 순서** (이 순서대로, 모두 한 번에 적용되고 덱을 다시 올릴 필요는 없다):
1. 작업트리가 깨끗한지 `git status`로 확인하고 `bun test deploy`가 통과하는지 본다(unpublish 단위 테스트와 Worker 동시 요청 테스트 포함).
2. `cd deploy/worker && bunx wrangler@4.150.0 deploy --dry-run --outdir /tmp/sk-wr`로 번들과 바인딩(LIMITER, DECKS)을 확인한다.
3. `bun run deploy --worker`: 코드, Durable Object 바인딩, 마이그레이션 v1이 함께 올라간다(`COOKIE_SECRET`은 이미 설정되어 있다).
4. `bun run deploy --smoke vibe-coding-workshop`: 모두 PASS여야 한다.
5. 게시를 취소해 볼 때는 먼저 `SLIDEKIT_DEPLOY_DRY_RUN=1 bun run slidekit unpublish <덱>`으로 지울 키를 보고, 사용자가 확인한 뒤에만 `--yes`를 붙인다(아래 절). 비밀번호 덱을 올릴 때: `bun run deploy <덱>`(비밀번호는 숨김 입력), 이어서 `bun run deploy --smoke vibe-coding-workshop <덱>`, 그리고 손으로 틀린 비밀번호 한 번과 맞는 비밀번호 한 번을 확인한다. 같은 IP로 틀린 비밀번호를 5번 보내면 6번째가 429이고 `Retry-After`가 붙는지도 한 번 본다.
6. 문제가 있으면 `cd deploy/worker && bunx wrangler@4.150.0 rollback`. 코드만 이전 버전으로 돌아가고 마이그레이션과 Durable Object 클래스는 남지만, 구코드가 쓰지 않으므로 해가 없다(KV 카운터로 돌아간다).

## 게시 취소: slidekit unpublish

배포한 덱을 Worker의 KV(`DECKS`)에서 지운다. 지우는 키는 `meta:<덱>`(공개 범위와 비밀번호 해시), `html:<덱>`(본문), `rl:<덱>:*`(로그인 시도 제한 카운터, 있으면)이다. meta를 먼저 지우므로 중간에 멈춰도 Worker는 404를 주고 남은 본문(html)은 열리지 않는다. 로컬 덱과 `dist/` 파일은 그대로다. Durable Object 시도 제한(`LIMITER`)을 쓰는 경우 카운터는 15분 뒤 알람으로 스스로 비워진다.

```
bun run slidekit unpublish <덱>          # 지울 목록만 보인다. 종료 코드 2
bun run slidekit unpublish <덱> --yes    # 실제로 지운다
SLIDEKIT_DEPLOY_DRY_RUN=1 bun run slidekit unpublish <덱>   # 지울 키만 출력한다. Cloudflare에 접속하지 않는다
```

- `--yes`가 없으면 게시된 덱인지 확인(읽기)하고 공개 범위, 제목, 지울 키 목록을 보인 뒤 종료 코드 2로 끝난다. 게시되지 않은 덱이면 종료 코드 3과 게시된 덱 목록을 보인다(그 밖의 실패는 1). 로그에 찍히는 제목과 덱 이름은 한 줄로 정리된다. 호출하는 쪽은 출력 문자열이 아니라 종료 코드로 판정한다.
- 토큰은 환경 변수 `CLOUDFLARE_API_TOKEN`이나 키체인 `slidekit-cloudflare-token`에서만 읽고 출력하지 않는다. wrangler는 `deploy/kv.ts`에 고정된 버전만 쓴다.
- 이미 퍼진 링크와 브라우저 캐시는 지울 수 없다. 공개 덱은 `max-age=0, must-revalidate`라 지운 뒤 다음 요청부터 404다.
- 이 명령의 실제 삭제는 사용자 승인 뒤에만 실행한다(개발 중에는 dry-run과 가짜 KV 단위 테스트만 돌렸다).

## 게시 기록

`bun run deploy <덱>`이 KV 업로드를 모두 끝낸 뒤 `decks/<덱>/.publish.json`에 기록을 남긴다(dry-run은 남기지 않는다). 모양은 `{ "current": Entry | null, "history": Entry[] }`이고 `Entry`는 `name`, `url`, `at`, `visibility`, `bytes`, `sha`(덱 지문)이며 취소하면 `unpublishedAt`이 붙는다. history는 최신순 최대 20개다. 지문은 `index.html`과 거기서 참조한 로컬 이미지의 `경로:크기`로 만들어서, 게시 뒤 덱이 바뀌었는지 비교한다. 구현은 `engine/publish-record.ts`(`deckFingerprint`, `readPublish`, `recordPublish`, `recordUnpublish`)이고 `slidekit unpublish` 명령은 이 파일을 건드리지 않는다(기록 정리는 서버가 한다).

