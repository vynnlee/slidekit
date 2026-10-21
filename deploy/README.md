# slidekit publishing (experimental, off by default)

> Publishing a deck to a Cloudflare Worker is **not part of slidekit v0.1**. The code is kept in this folder, but the Publish menu, the `deploy` and `unpublish` commands, and the publishing API routes are all switched off. Everything here is something you set up and run yourself, with your own Cloudflare account and domain. (한국어: v0.1에서는 배포 기능이 기본으로 꺼져 있다. 아래를 직접 설정해야 켜진다.)

## Turn it on (set it up yourself)

1. Create your own Worker config. `deploy/worker/wrangler.toml` ships with **example values**: change `routes` to your own domain (`static.example.com` is a placeholder) and create a KV namespace for `id` (`cd deploy/worker && bunx wrangler kv namespace create DECKS`, then paste the id; it is empty in the repo).
2. Log in to Cloudflare (`bunx wrangler login`) or provide an API token. Set a cookie-signing secret for the password gate: `openssl rand -base64 32 | bunx wrangler secret put COOKIE_SECRET` (run in `deploy/worker`).
3. Deploy the Worker once: `SLIDEKIT_EXPERIMENTAL_DEPLOY=1 SLIDEKIT_PUBLISH_HOST=https://static.your-domain.example bun run deploy --worker`.
4. Run slidekit with the same two variables to see the feature:
   - `SLIDEKIT_EXPERIMENTAL_DEPLOY=1` turns publishing on. Without it the app hides Publish, the API answers 404 (`experimental`), and `deploy`/`unpublish` print how to enable it and exit.
   - `SLIDEKIT_PUBLISH_HOST=https://static.your-domain.example` is where published decks live (https, host only, no path). It is also the only host recorded publish URLs may point to. Without a valid value the feature stays off.
5. Publish: `bun run slidekit bundle <deck>` then `bun run slidekit deploy <deck>` (or Export, Publish in the app). Unpublish: `bun run slidekit unpublish <deck> --yes`.

Tests for this folder are not part of the default gate: `bun scripts/test.ts --only deploy-unit` (Worker routes, CSP, host extraction, deck.md, unpublish) and `--only deploy-csp` (real browser, local server) run only on request or with `--slow`.

The rest of this file is the maintainer's original notes (Korean) and mentions the author's own domain and account as history.

# slidekit 배포

**배포 이력**: 2026-10-15 작성자의 Worker 배포(사용자 승인). 리허설 전체 통과, `bun run deploy --worker`, `bun run deploy --smoke <공개덱>` 전체 통과. 롤백은 `cd deploy/worker && bunx wrangler@4.150.0 rollback`.

**Worker 배포 체크리스트** (다음 Worker 변경 때도 사용자 승인 전에는 실행하지 않는다. 자세한 설명은 아래 "Worker 배포 준비와 점검")
1. 사전: `git status`가 깨끗하고 `bun deploy/rehearse.ts`가 전체 통과(단위 테스트, 드라이런, 로컬 Worker와 로그인 제한 리허설. 원격 호출과 토큰이 없다).
2. 토큰: 키체인 `slidekit-cloudflare-token`이 있는지 `bun run slidekit doctor`로 본다(값은 출력하지 않는다).
3. 배포: `bun run deploy --worker`(코드, Durable Object 바인딩, 마이그레이션 v1이 한 번에 올라간다. `COOKIE_SECRET`은 이미 설정되어 있다).
4. 확인: `bun run deploy --smoke <공개덱>`이 모두 PASS(비밀번호 덱이 있으면 이름을 하나 더 준다). 실패하면 바로 5번.
5. 롤백: `cd deploy/worker && bunx wrangler@4.150.0 rollback`(코드만 이전 버전으로 돌아가고 마이그레이션과 DO 클래스는 남지만 구코드가 쓰지 않아 해가 없다. 로그인 제한은 KV 카운터로 돌아간다).
6. 사용자만 하는 것: Cloudflare 토큰 발급과 `wrangler login`, 3번 실행 승인, 게시 취소의 `--yes`. 에이전트는 이 셋을 직접 하지 않는다.

1. Cloudflare 대시보드에서 토큰을 만든다(계정 권한: Workers Scripts 편집, Workers KV Storage 편집, Account Settings 읽기. example.com zone 권한: DNS 편집, Workers Routes 편집, Zone 읽기. 계정 하나와 zone 하나로 범위를 좁힌다). 키체인 저장: `security add-generic-password -a $USER -s slidekit-cloudflare-token -w` (토큰은 프롬프트에 붙여넣기). 토큰 이름은 slidekit-static-deploy이고 2026-10-13에 만들었다.
2. `cd deploy/worker && bunx wrangler kv namespace create DECKS` 결과의 id를 `wrangler.toml`의 `REPLACE_WITH_KV_NAMESPACE_ID`에 넣는다. 토큰은 `export CLOUDFLARE_API_TOKEN=$(security find-generic-password -s slidekit-cloudflare-token -w)`로 셸에 올린다.
3. 쿠키 서명 키 등록: `openssl rand -base64 32 | bunx wrangler secret put COOKIE_SECRET` (deploy/worker에서).
4. example.com이 Cloudflare DNS에 있으면 Worker 배포 때 `static.example.com`이 자동 연결된다. 첫 배포: `bun run deploy --worker`
5. 덱 올리기: 번들 후 `bun run deploy <덱>` (비밀번호 덱이면 비밀번호를 물어본다). 주소는 static.example.com/<덱>.

공개 덱은 올릴 때 `deck-meta`의 `title`도 함께 올라간다. 비밀번호 덱은 인증 전에 제목이 보이므로 `deck-meta`에 `"lockTitle": true`를 적은 경우에만 올린다. 비밀번호는 8자 이상이고, 바꾸면 이미 발급된 쿠키가 모두 무효가 된다. 비밀번호, 잠금(5회 틀리면 15분), 404 안내 페이지는 같은 모양이며 모바일 390px에서도 한 칸 폭을 지킨다. Worker 변경은 `bun run deploy --worker`로 올려야 반영된다.

## Worker 배포 준비와 점검 (2026-10-14 작성, 2026-10-15 배포 완료)

사용자 승인 뒤에만 `bun run deploy --worker`를 실행한다. 아래는 2026-10-15 배포 전에 끝낸 읽기와 드라이런 결과이고, 다음 변경 때 같은 순서를 쓴다.

**드라이런**: `cd deploy/worker && bunx wrangler@4.150.0 deploy --dry-run --outdir <임시폴더>`(토큰 없이 됨). 번들 9.0 KiB, gzip 3.9 KiB, 바인딩은 KV `DECKS` 하나. 새 바인딩이나 마이그레이션은 없다.

**2026-10-15 배포 전 구버전과의 차이**(모두 배포되었다): 이전 Worker는 2026-10-13 커밋 `451f134` 시점이었다. 이후 `a7715c6`, `a727d33`가 `deploy/worker/src/index.ts`를 바꿨다(57줄 추가, 33줄 삭제). 사용자에게 보이는 변화:
- 비밀번호 덱의 기존 로그인 쿠키가 모두 무효가 된다(서명에 비밀번호 salt를 넣음). 모두 한 번 다시 입력한다. 공개 덱은 영향 없다.
- 비밀번호 덱은 주소창 이동(문서 요청)에만 응답한다. 다른 덱의 스크립트가 `fetch`로 읽으면 403이다. 정상적인 열람은 같다.
- 안내 페이지(비밀번호 폼, 잠금, 404, 설정 오류)가 한 모양으로 통일되고 한국어와 영어로 나온다. 비밀번호 폼은 nonce CSP이며, 덱 제목은 `lockTitle` 옵트인 덱만 보인다.
- 응답 헤더 추가: `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `Strict-Transport-Security`. 공개 덱 캐시는 `public, max-age=60`에서 `public, max-age=0, must-revalidate`로 바뀌어 수정이 바로 보인다.
- GET, HEAD, POST 외 메서드는 405, `Origin: null`이나 깨진 Origin의 POST는 403이다.
- 이미 올린 덱은 다시 올릴 필요가 없다(KV 형식 변경 없음). 새 `title`은 다시 올릴 때부터 meta에 들어간다.

**배포 뒤 점검**: `bun run deploy --smoke [공개덱 [비밀번호덱]]`. GET만 보내며 토큰이 필요 없다. 공개 덱과 없는 덱 응답의 보안 헤더(nosniff, COOP, HSTS, frame-ancestors none, noindex), 공개 덱 200과 캐시 `must-revalidate`, 슬라이드 HTML, 없는 덱 404, 비밀번호 덱의 폼(슬라이드 없음, nonce CSP, no-store)과 문서가 아닌 요청 403을 확인한다. 2026-10-15 배포 뒤 전체 PASS였다(구버전에 실행하면 COOP, HSTS, 캐시 항목이 FAIL로 나오는 것이 정상이었다). 손으로 할 것은 사용자 몫으로 남아 있다(시도 횟수를 쓰므로 스크립트에 넣지 않았고, 비밀번호 덱을 올려야 해서 에이전트는 하지 않았다): 비밀번호 덱에서 틀린 비밀번호 한 번(401 안내가 뜨는지), 맞는 비밀번호 한 번(덱이 열리고 쿠키가 생기는지). 문제가 있으면 `cd deploy/worker && bunx wrangler@4.150.0 rollback`으로 직전 버전으로 되돌린다(KV 데이터는 그대로다).

**로그인 시도 제한(2026-10-15 배포됨)**: Durable Object `Limiter`(SQLite 기반)가 덱과 IP를 키로 시도를 세고, 검사와 증가를 한 번에 해서 동시 요청이 5번을 넘기지 못한다(15분 창에서 5회, 맞으면 지움, 창이 끝나면 알람으로 저장소를 비움). `LIMITER` 바인딩이 없으면 이전과 같은 KV 카운터로 동작해 구버전 배포와도 호환된다. 단위 테스트가 동시 요청 30개 중 정확히 5개만 비밀번호를 시험함을 보이고, 같은 조건에서 KV 폴백이 5개를 넘기는 것도 보인다. `wrangler.toml`에 바인딩과 마이그레이션 `v1`(`new_sqlite_classes`)이 있고 `--dry-run`이 통과한다(번들 10.6 KiB, gzip 4.4 KiB, 바인딩 LIMITER와 DECKS). 마이그레이션 적용 자체는 드라이런으로 검증할 수 없고 첫 실제 배포에서 일어난다.

선택지 비교(공식 문서로 확인한 수치):
- Durable Object: 무료 플랜은 SQLite 기반만 쓸 수 있고, 하루 요청 100,000건, 기간 13,000 GB-s, 행 읽기 500만, 행 쓰기 100,000, SQL 저장 5 GB(합계) 한도다. 이 용도(시도 한 번에 쓰기 두세 행)는 한도에 한참 못 미친다. https://developers.cloudflare.com/durable-objects/platform/pricing/
- Rate Limiting 바인딩: 기간이 10초 또는 60초뿐이고 데이터센터별 집계이며 비동기로 동기화되어 허용 쪽으로 느슨하다. 15분 5회를 표현하지 못한다. 요금제 조건은 문서에 없다. https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- 결론: Durable Object를 쓴다(구현함).

**실행 순서** (2026-10-15에 이 순서로 실행했다. 다음 변경 때도 승인 뒤에 이 순서로, 모두 한 번에 적용되고 덱을 다시 올릴 필요는 없다):
1. 작업트리가 깨끗한지 `git status`로 확인하고 `bun test deploy`가 통과하는지 본다(unpublish 단위 테스트와 Worker 동시 요청 테스트 포함).
2. `cd deploy/worker && bunx wrangler@4.150.0 deploy --dry-run --outdir /tmp/sk-wr`로 번들과 바인딩(LIMITER, DECKS)을 확인한다.
3. `bun run deploy --worker`: 코드, Durable Object 바인딩, 마이그레이션 v1이 함께 올라간다(`COOKIE_SECRET`은 이미 설정되어 있다).
4. `bun run deploy --smoke <공개덱>`: 모두 PASS여야 한다.
5. 게시를 취소해 볼 때는 먼저 `SLIDEKIT_DEPLOY_DRY_RUN=1 bun run slidekit unpublish <덱>`으로 지울 키를 보고, 사용자가 확인한 뒤에만 `--yes`를 붙인다(아래 절). 비밀번호 덱을 올릴 때: `bun run deploy <덱>`(비밀번호는 숨김 입력), 이어서 `bun run deploy --smoke <공개덱> <덱>`, 그리고 손으로 틀린 비밀번호 한 번과 맞는 비밀번호 한 번을 확인한다. 같은 IP로 틀린 비밀번호를 5번 보내면 6번째가 429이고 `Retry-After`가 붙는지도 한 번 본다.
6. 문제가 있으면 `cd deploy/worker && bunx wrangler@4.150.0 rollback`. 코드만 이전 버전으로 돌아가고 마이그레이션과 Durable Object 클래스는 남지만, 구코드가 쓰지 않으므로 해가 없다(KV 카운터로 돌아간다).

## 덱 CSP (M2a, 코드와 시험까지 끝, 아직 배포 안 함)

설계는 `spec/WORKER-CSP.md`. Worker가 덱 응답(공개, 비밀번호 통과 뒤)에 `default-src 'none'`, `connect-src 'none'`, `form-action/frame-src/worker-src 'none'`을 붙여 공개된 덱의 스크립트가 데이터를 밖으로 보내지 못하게 한다. 인라인 스크립트와 스타일, `data:`/`blob:` 자원은 허용하고, 덱이 쓰는 외부 호스트(이미지, 미디어, 글꼴, 스타일의 `https`)만 KV 메타 `hosts`로 연다. 호스트는 `deploy.ts`가 번들에서 뽑아 올리고(20개까지, 형식이 틀리면 건너뛰고 경고) Worker가 다시 검증한다. 메타에 `hosts`가 없거나 틀리면 가장 엄격한 정책이다. 입력 폼, 안내, 오류는 이미 더 엄격해서 그대로다.

- 올리기 전 확인표: `bun deploy/csp-check.ts [덱...] [--build]`. 덱마다 번들 크기, CSP가 허용할 호스트, 허용하지 못한 외부 자원, 막힐 사용(스크립트의 `fetch`, `WebSocket` 등, `iframe`, 폼 `action`), 판정(OK, CHECK, NO BUNDLE)을 표로 찍는다. 이 표를 Worker 배포 승인 요청에 같이 올린다. CHECK인 덱은 게시본을 열어 해당 기능이 막혀도 되는지 본다.
- 시험: `bun test deploy`(정책 문자열, 호스트 필터와 추출), 러너 `deploy-csp`(실제 번들 두 개가 위반 0건, 유출을 시도하는 덱은 수신구에 한 건도 안 닿음, CSP 없는 대조군은 유출함. 브라우저라 성능 좋은 기계에서 돌린다), `deploy --smoke`(배포 뒤 헤더 확인에 CSP와 Permissions-Policy 검사 추가).
- 배포 순서: 승인 → `bun run deploy --worker` → `bun run deploy --smoke <공개덱>` → 게시된 덱을 모두 열어 확인. 이미 게시된 덱은 메타에 `hosts`가 없어도 정책이 켜진다(번들이 외부 자원을 안 쓰면 영향 없음). 외부 호스트를 쓰는 덱은 다시 `deploy`하면 `hosts`가 채워진다. 롤백은 아래 방법(`wrangler rollback`).

## deck.md (M3b, 코드와 단위 시험까지 끝, 아직 배포 안 함)

설계는 `spec/DECK-MD-DEPLOY.md`. 배포하면 덱 옆에 발표자 노트가 없는 Markdown(`https://static.example.com/<덱>/deck.md`)이 같이 올라가고, 올라가는 HTML의 `<head>`에 `<link rel="alternate" type="text/markdown" href="/<덱>/deck.md">`가 들어간다(로컬 `dist/<덱>.html`과 원본 덱은 그대로). 에이전트가 덱의 글을 HTML 해석 없이 읽고 이어서 작업하게 하려는 것이다. 앱의 배포 완료 화면과 Published 대화상자에 **Copy agent prompt**가 있다(공개 덱은 주소와 `curl -s <주소>/deck.md`, 비밀번호 덱은 주소만).

- 올리는 순서는 meta, deck.md(`md:<덱>`), html. `deploy`는 `dist/<덱>.md`(없으면 번들에서 생성)에 발표자 노트 글이 한 줄이라도 있으면 중단한다. `unpublish`는 `md:<덱>`이 있으면 같이 지운다.
- Worker: 공개 덱의 `deck.md`는 누구나, 비밀번호 덱의 `deck.md`는 덱과 같은 쿠키 관문 뒤에서만(쿠키가 없으면 403, `Sec-Fetch-Dest`가 `document`가 아니면 403). 쿠키 경로가 `/<덱>`이라 주소가 `/<덱>/deck.md`다.
- 시험: `bun test deploy`(Worker 라우트, 노트 누출 중단, alternate 삽입, unpublish), `app/test/agent-prompt.test.ts`, 브라우저 `export` 단계(Copy agent prompt). 배포 뒤 `deploy --smoke`에 deck.md 검사가 있다.
- 배포 순서는 위 "덱 CSP" 절과 같고(승인 → `--worker` → `--smoke`), 이미 게시된 덱은 다시 `deploy`해야 deck.md가 생긴다(없으면 `deck.md`는 404).

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

