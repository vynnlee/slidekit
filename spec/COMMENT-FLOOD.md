# 코멘트 자동 처리 폭주 방지(M5)

코멘트가 채널로 Claude에 자동 전달되면 그때마다 에이전트가 일을 시작한다(토큰과 덱 수정). 코멘트를 한꺼번에 많이 남기거나 조작된 덱이 코멘트를 쏟아도 사용자가 모르는 새 자동 처리가 폭주하지 않게 **시간당 상한**과 **중단 장치**를 둔다. 기존 흐름은 상한 아래에서는 그대로다.

## 1. 무엇을 세나

"자동 처리"는 채널이 코멘트를 Claude에 **전달**하는 일이다(`push`, `pushBatch`, `get_pending`이 가져가기). 전달 시각은 이미 코멘트의 `deliveredAt`에 남으므로 새 저장소 없이 **모든 덱의 `deliveredAt`이 최근 60분 안인 코멘트 수**가 사용량이다(재시작해도 유지된다). 상한 기본 60개/시간, 환경 변수 `SLIDEKIT_COMMENT_HOURLY`로 바꾼다(0이면 끈다). 한 코멘트는 한 번만 센다(재전달 없음).

## 2. 서버(`app/comments.ts`)

- `GET /api/comments/flow` → `{ paused, limit, used, remaining, resetAt, reason }`. `reason`은 보낼 수 없을 때만 `"user"`(Pause) 또는 `"limit"`(상한). `resetAt`은 가장 오래된 사용분이 60분을 채우는 시각(상한일 때만).
- `POST /api/comments/flow` `{ paused: boolean }`: 사용자가 Pause와 Resume. 상태는 키 파일 옆 `flow.json`에 저장해 재시작 뒤에도 유지한다(코멘트 키와 같은 기기 상태, 덱에 넣지 않는다). Resume하면 채널이 밀린 코멘트를 따라잡는다(기존 backfill).
- SSE `flow` 이벤트(`GET /api/events`): 같은 모양을 보낸다. 상태가 바뀔 때(Pause, Resume, 상한 도달, 시간이 지나 풀림)와 새 연결 때 현재 값을 보낸다. 상한 풀림은 `resetAt`에 맞춘 타이머로 보낸다.
- 새 코멘트 등록과 저장은 막지 않는다. 막는 것은 Claude로의 **전달**뿐이고, 막힌 코멘트는 `Waiting`(전달 안 됨) 그대로 남는다.

## 3. 채널(`channel/index.ts`)

- `push`와 `pushBatch`와 `backfill`은 보내기 전에 `GET /api/comments/flow`로 `paused`와 `remaining`을 본다. 멈춤이거나 `remaining`이 0이면 보내지 않고(표시도 전달됨으로 안 바꾼다) 건너뛴다. 묶음은 `remaining`만큼만 보낸다. 서버를 못 읽으면 기존처럼 보낸다(보호 장치가 흐름을 막는 쪽으로 실패하지 않는다).
- `get_pending` 도구는 멈춤이나 상한이면 목록 대신 한 줄 안내(`코멘트 자동 처리가 멈춰 있다(Pause 또는 시간당 상한). 사용자가 앱에서 Resume 하면 이어진다`)만 준다. 데이터가 아니라 서버 문구이므로 덱의 글자는 섞지 않는다.
- `flow` 이벤트로 멈춤이 풀리면(Resume, 상한 풀림) `backfill`을 다시 돈다(오래된 순, 한 번에 BATCH개).
- 동시성: 확인과 전달 사이에 다른 전달이 끼어 상한을 몇 개 넘을 수 있다(소프트 상한, 최대 BATCH-1개 초과). 정확한 예약은 필요하지 않다.

## 4. 화면(`CommentsPanel.tsx`, 내 소유)

- 패널 머리에 한 줄 상태: `Claude: auto-processing` / `Paused` / `Limit reached (60 per hour). Resumes at 14:20`. 단추 `Pause`와 `Resume`(`aria-pressed` 없이 이름이 바뀐다). 상태는 `role="status"`로 읽어 준다.
- 상한에 닿으면 토스트 한 번(`Comment limit reached: 60 per hour. New comments wait until 14:20.`). 같은 사건은 풀리기 전까지 반복하지 않는다.
- 작성창의 보내기 안내는 멈춤이나 상한이면 `Claude is paused. Send now saves it and sends when you resume.`로 바뀐다. Send now와 Send all은 막지 않고 저장만 한다(전달은 위 규칙).
- 항목 상태는 그대로 `Waiting`이다(새 상태를 만들지 않는다).

## 5. 보안과 호환

- 사용자가 앱에서만 Resume한다. 채널(에이전트)이 Resume하거나 상한을 바꾸는 도구는 만들지 않는다. `POST /flow`는 다른 변경 API와 같은 Host와 Origin 검사를 받는다.
- 환경 변수가 없으면 60/시간이고, 한도 아래의 기존 흐름(ack, reply, Send all 10개 상한, backfill)은 바뀌지 않는다.
- 덱 파일과 `comments.json` 형식은 바뀌지 않는다(사용량은 `deliveredAt`에서 계산, 멈춤은 별도 `flow.json`).

## 6. 시험

- 단위: 사용량 계산(60분 창, 덱 여러 개 합산, `deliveredAt` 없는 것 제외), 한도 0은 끔, `resetAt`, `flow.json` 저장과 손상 파일, 입력 검증(`paused`는 불리언).
- 채널 통합(`channel/flood.ts`, `SLIDEKIT_COMMENT_HOURLY=2`): 코멘트 3개 → 2개만 전달되고 3번째는 `Waiting`, `flow` 이벤트에 `reason:"limit"`, Pause 중에는 새 코멘트가 전달되지 않고 `get_pending`이 안내만 줌, Resume하면 밀린 것이 오래된 순으로 전달, 서버 재시작 뒤에도 멈춤 유지, 상한 아래의 기존 흐름 불변(기존 channel 시험이 그대로 통과).
- 브라우저(`comments-e2e` 확장): 패널 상태 줄과 Pause 단추, 토스트, 작성창 안내.
