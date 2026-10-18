# 배포 Worker의 덱 CSP (M2a)

배포 Worker(`deploy/worker/src/index.ts`)가 덱 응답에 **엄격한 Content-Security-Policy**를 붙인다. 목적은 공개된 덱의 스크립트가 **데이터를 밖으로 보내지 못하게** 하는 것이다(Artifact의 격리 출처와 엄격 CSP를 덱 번들에 맞게 옮긴 것). 덱과 엔진은 바닐라 그대로이고 새 의존성은 없다. **이번 범위는 코드, 단위 시험, 로컬 리허설, 브라우저 시험까지이고 Worker 실제 배포와 `unpublish`는 사용자 승인 뒤다.**

## 1. 지금 상태

- 덱 응답(공개, 비밀번호 통과 뒤)의 CSP는 `frame-ancestors 'none'` 하나다(`index.ts`의 `headers`, 주석: 덱이 인라인 스크립트와 스타일을 써서 `script-src`를 건드리지 않는다). 비밀번호 입력 폼은 이미 `default-src 'none'`과 nonce 기반 CSP다.
- 그래서 게시된 덱의 스크립트는 `fetch`, `WebSocket`, `<img src>`, `<form action>`, `navigator.sendBeacon` 등으로 어디든 보낼 수 있다. 같은 출처의 다른 덱을 읽는 것은 `Sec-Fetch-Dest` 검사(보호된 덱은 문서 요청만)와 COOP, CORP가 이미 막는다.
- 번들러는 이미지, srcset, 글꼴 서브셋을 단일 HTML에 인라인한다(`data:`). 그래서 정상 번들은 외부 자원 요청이 없다(`engine-offline`이 확인). 덱의 `lint`는 남은 외부 `src`, `href`, `url()`을 경고한다.

## 2. 정책

덱 응답마다 아래를 붙인다(`<hosts>`는 4절의 덱별 외부 호스트, 보통 비어 있다).

```
default-src 'none';
script-src 'unsafe-inline';
style-src 'unsafe-inline' <hosts>;
img-src data: blob: <hosts>;
font-src data: <hosts>;
media-src data: blob: <hosts>;
connect-src 'none';
form-action 'none';
frame-src 'none';
object-src 'none';
worker-src 'none';
manifest-src 'none';
base-uri 'none';
frame-ancestors 'none'
```

- **`connect-src 'none'`**: 설계 목록은 "자기 출처만"이었으나 `'none'`을 추천한다. 번들 덱에는 어떤 `fetch`도 필요 없고(M2b `doctor --artifact`도 외부로 나가는 `fetch`와 `WebSocket` 금지), `'self'`를 열면 같은 출처의 다른 덱 URL로 요청을 보낼 수 있다(응답은 `Sec-Fetch-Dest` 검사로 막히지만 요청 자체는 간다). 결정 1.
- **`script-src 'unsafe-inline'`**: 번들의 엔진과 덱 스크립트가 인라인이다. 덱 글자는 작성자 본인의 것이라 주입 방어가 목적이 아니고 **유출 차단**이 목적이다. 해시 방식(`'sha256-…'`)은 인라인 `on*` 속성에 `'unsafe-hashes'`가 필요해 복잡하고 얻는 것이 적어 하지 않는다(대안 기록).
- `img-src`, `media-src`, `font-src`, `style-src`에 `data:`/`blob:`(엔진 썸네일, 인라인 자원)와 덱이 실제로 쓰는 외부 호스트만 허용한다.
- 추가 헤더: `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), display-capture=()`(덱이 쓸 이유가 없다). 기존 헤더(`nosniff`, `Referrer-Policy: no-referrer`, HSTS, COOP, CORP)는 그대로다.
- 적용 범위: `page()`가 돌려주는 덱 HTML(공개와 비밀번호 통과 뒤). 입력 폼, 안내 페이지(`shell`), 303, 오류는 이미 더 엄격하므로 바꾸지 않는다.

## 3. 호환 규칙과 위험

| 위험 | 대응 |
|---|---|
| 덱이 외부 글꼴이나 이미지를 번들 뒤에도 가진다 | 4절의 호스트 허용. 번들러가 인라인하지 못한 자원만 남는다. |
| 엔진의 `blob:` 썸네일, `data:` 이미지 | `img-src data: blob:`. 엔진 시험(`engine-offline`)과 같은 번들로 브라우저 시험에서 위반 0건을 확인. |
| 이미 게시된 덱(메타에 호스트가 없음) | 호스트 목록이 비면 가장 엄격한 정책. 기존 워크숍 덱은 글꼴을 인라인한 번들이라 영향이 없다고 본다(리허설에서 확인). 깨지면 `deploy`를 다시 하면 호스트가 채워진다. |
| 정책이 틀려 정상 덱이 깨짐 | 승인 전에 로컬 리허설과 브라우저 시험으로 가이드 덱과 워크숍 덱 번들이 위반 0건인지 본다. 배포 직후 `deploy --smoke`로 헤더를 확인한다. 롤백은 기존 방법(`wrangler rollback`). |
| 사용자 덱 스크립트의 `fetch` | 막힌다. 이것이 목적이다. 막힌 요청은 콘솔에 CSP 위반으로 보이고 `lint`가 이미 `fetch`, `XMLHttpRequest`를 경고한다. |

## 4. 덱별 외부 호스트

- `deploy.ts`가 올릴 번들 HTML을 읽어 `<link href>`, `<img/video/audio/source/script src>`, `srcset`, `url(...)`, `@import`에서 `https://호스트`를 모은다. 소문자 호스트 이름만(`^[a-z0-9.-]+$`, 와일드카드와 포트와 경로 없음), 20개까지, 중복 제거. 안 맞는 항목은 무시하고 경고한다. 글꼴 호스트(`fonts.googleapis.com`, `fonts.gstatic.com`)도 같은 규칙이다.
- 결과를 KV 메타의 `hosts`(문자열 배열)로 올린다. Worker는 `meta.hosts`를 다시 검증(정규식, 개수)한 뒤에만 정책에 넣는다. 검증을 통과하지 못한 값은 버린다(KV가 오염되어도 정책이 느슨해지지 않는다).
- 호스트 하나는 `https://호스트`로 정책에 들어간다(`http:`는 허용하지 않는다).

## 5. 합격 기준

1. 공개 덱, 비밀번호 통과 뒤 덱의 응답에 위 정책이 정확히 붙는다. 폼, 안내, 303, 오류 응답의 CSP는 그대로다.
2. `meta.hosts`가 정책에 들어가고, 형식이 틀린 값(`*`, 경로, 포트, `http`, 큰 대문자, 21개째)은 무시되며 정책에 흔적이 없다. 메타에 `hosts`가 없으면 가장 엄격한 정책이다.
3. 가이드 덱과 워크숍 덱의 **실제 번들**을 Worker 로컬 서버(`wrangler dev`)로 열면 슬라이드가 정상 동작하고 CSP 위반이 0건이다(`securitypolicyviolation` 이벤트와 콘솔).
4. 덱 스크립트가 `fetch`, `WebSocket`, `new Image().src`(외부), 폼 전송, `sendBeacon`으로 밖에 보내려는 시도는 모두 위반으로 막힌다(시험용 덱으로 확인).
5. 기존 보안 시험(로그인 제한, Origin 검사, 문서 요청만 서빙)과 `rehearse.ts` 전체가 그대로 통과한다.

## 6. 시험 계획

- 단위(`deploy/worker/src/index.test.ts`, `bun test`): 합격 1, 2. 헤더 문자열 비교와 호스트 필터 표(허용, 무시 각 8개 이상).
- 호스트 추출 단위(`deploy/hosts.ts` 또는 `deploy.ts` 안 함수와 `deploy/hosts.test.ts`): 번들 HTML 조각에서 추출, 중복, 20개 제한, 잘못된 호스트 경고.
- 리허설(`deploy/rehearse.ts`): 로컬 Worker에 가짜 덱을 올린 뒤 응답 헤더에 정책이 붙는지(공개), 폼 응답은 그대로인지 확인을 추가.
- 브라우저(새 단계 `deploy-csp`, 러너의 `deploy` 계열): 실제 번들 두 개를 로컬 Worker로 열고 합격 3, 4. 발열 때문에 브라우저 시험은 사용자와 정한 방식으로만 돌린다.
- 배포 뒤(승인 필요): `deploy --smoke`에 CSP 헤더 검사를 더한다(요청 한 번, 브라우저 불필요).

## 7. 구현 순서

1. `hosts` 추출과 단위 시험.
2. Worker 정책 생성과 단위 시험.
3. `deploy.ts`가 메타에 `hosts`를 올린다(드라이런 e2e로 확인, 원격 쓰기 없음).
4. 리허설 확장, 브라우저 시험 `deploy-csp`.
5. `deploy/README.md`와 HANDOFF 갱신(배포 순서와 롤백 문구).

## 8. 결정이 필요한 것

1. `connect-src`를 `'none'`으로 할지(추천) `'self'`로 할지.
2. 외부 이미지, 미디어 호스트를 덱이 쓴 만큼 허용할지(추천), 아니면 글꼴 호스트만 허용하고 나머지는 막을지(더 엄격하지만 번들러가 인라인하지 못한 이미지가 깨진다).
3. 배포는 사용자 승인 뒤: 기존 게시 덱의 메타에 `hosts`가 없어도 정책이 켜지므로, 첫 배포 직후 게시된 덱을 모두 열어 보는 확인 단계(`--smoke`와 사용자 눈)를 둘지.
