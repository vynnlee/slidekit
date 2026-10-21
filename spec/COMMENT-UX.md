# 코멘트 생명주기와 UX 개선 설계

사용자 요청: "comment 생명주기 및 동작, UX/UI가 많이 아쉽다. Claude Artifacts와 Figma의 comment 기능을 조사해 벤치마킹해서 개선". 이 문서는 **설계만**이고 구현은 3절 결정을 사용자가 정한 뒤에 한다.

- 근거 문서: 벤치마크 사실 `spec/COMMENT-UX-BENCH.md`(출처 URL, 확인 못 한 것 표시), 우리 코드 감사 `spec/COMMENT-UX-AUDIT.md`(file:line), 화면 상세 설계 `spec/COMMENT-UX-UI.md`(editor-dev, 핀·팝오버·패널·모바일).
- 분담: 상태기계, 데이터, 서버, 채널, 작성창 문구, 앵커는 channel-dev(이 문서). 핀 모양, 호버, 스레드 팝오버 배치, 패널 카드와 필터, 바텀 시트는 editor-dev(`COMMENT-UX-UI.md`). 두 문서의 용어는 화면 기준 **Saved, Sent, Working, Replied, Resolved(+ Unverified 배지)**로 맞춘다.
- 기존 설계와의 관계: 코멘트 모드(`COMMENT-MODE.md`), 에이전트 수정과 존재 신호(`AGENT-PRESENCE.md`), 자동 처리 상한과 Pause(`COMMENT-FLOOD.md`)는 그대로 두고 그 위에 얹는다.

## 0. 한눈에

감사에서 나온 가장 큰 구멍 일곱 가지와 이 설계의 답.

| # | 지금 | 이 설계 |
|---|---|---|
| 1 | Sent·Working에서 세션이 끊기면 영구 정지(재전송, 취소, 시간 초과 없음) | 멈춘 요청을 **Stalled**로 드러내고 `Resend`와 `Cancel`을 준다. 채널이 다시 붙으면 ack 없는 전달분을 되살린다(4.3) |
| 2 | 답은 코멘트당 한 번, 스레드 없음, 질문도 "Replied", 일괄 해결이 질문까지 처리 | **스레드**(사용자 ↔ Claude 번갈아). Claude의 답은 `done` 또는 `question`이고 질문은 별도 표시와 일괄 해결 제외(4.2) |
| 3 | "Reopen"은 재요청이 아님(reply 409) | Reopen은 스레드를 다시 열고 후속 메시지를 보낼 수 있다. `Ask again` 한 단추(4.2) |
| 4 | Claude 수정·복원 때 슬라이드 번호 갱신 안 됨, `slideDeleted` 영구, 복원 오탐 | 덱이 바뀔 때마다 **앵커를 다시 계산**(되돌릴 수 있음). 잃은 코멘트는 **Detached** 구역에 남는다(4.4) |
| 5 | Send all이 Pause·상한·미연결에서도 "Sent N"이라고 거짓 성공 | 서버가 결과를 `sent` 와 `waiting`(+이유)으로 돌려주고 토스트가 그대로 말한다(4.5) |
| 6 | 서명 안 된 코멘트 막다른 길(일괄 Trust 없음), 서명 없는 reply도 "Replied" | `Trust all` 일괄, Claude의 reply도 서명(4.6) |
| 7 | 핀 색이 상태를 못 가름, Waiting의 이유가 항목에 없음, SSE 재접속 뒤 재동기화 없음 | 항목마다 **막힌 이유 한 줄**, 목록 재동기화, 핀 상태는 UI 문서 4절(5절) |

## 1. 벤치마크 (사실은 `COMMENT-UX-BENCH.md`, 여기는 판단)

| 항목 | 그들은 어떻게 | 우리는 지금 | 가져올 것 | 버릴 것 |
|---|---|---|---|---|
| 에이전트에게 보내는 경계 | Artifacts: 편집 권한자가 `Send to Claude` 또는 `@claude`로 **스레드를 활성화**해야 Claude가 답하고 resolve한다. 덱과 Docs는 "Send to Claude" 체크박스(Docs는 기본 선택, 마지막 설정 기억). 안 보낸 코멘트는 사람끼리 메모 | Add(보류)/Send now, 보류는 Send all로만 | 코멘트별 "보낼지"를 **작성창에서 한 번에**(3절 결정 1), 마지막 선택 기억 | 권한 단계(우리는 한 사용자) |
| 에이전트가 건드릴 수 있는 범위 | Claude는 활성화된 스레드만 답·해결, 나머지는 사람이 해결 | Claude는 ack·reply만, 해결은 사람 | 같은 원칙 유지: **Claude는 Resolve하지 않는다**(사용자만) | - |
| 폭주 방지 | 활성화·코멘트 60건/시간 뒤 알림 1회, 중지 3단계(일시정지, 작업 중지, 세션 전체) | M5: 60/시간, Pause, 토스트 | 완료. 문구만 `Paused`/`Limit reached`로 통일(5절) | - |
| 자동 응답 표시 | 터미널 `Auto-replied…`/`Comments are waiting…` (웹 배지는 확인 못 함) | `Working` 상태와 존재 신호 | 상태로 충분 | - |
| 스레드·답글 | Figma/Docs/Notion/Linear 모두 답글 스레드. Claude Code Artifacts는 스레드가 있고 Claude는 활성화된 스레드만 답·해결, Claude Science 문서의 아티팩트 코멘트는 스레드와 해결이 없다(UI 문서 조사) | 단일 reply | **스레드**(4.2) | 이모지 반응, @멘션, 이미지 첨부(Figma) |
| 해결·재열기 | Figma: 해결하면 캔버스·패널에서 숨김, `Show resolved`로 복원. Docs: Resolve/Re-open | 해결=흐리게, Reopen은 상태만 되돌림 | 해결은 **구역으로 모음**(핀 숨김은 UI 문서), Reopen=스레드 재개(4.2) | - |
| 읽음 | Figma: Mark as unread, 정렬 Unread. Notion: 안 읽은 코멘트 빨간 점 | 없음(토스트 한 번) | `unread`(Claude 답이 오면 켜짐), 서버 저장(결정 5) | - |
| 앵커 | Figma: 코멘트는 최상위 frame에 붙고 잘라 붙이면 **분리되지만 사이드바에 남는다**. GitHub는 outdated 표시(정의 문서 없음) | 저장 때만 remap, `slideDeleted` 영구, 복원 오탐 | **분리(Detached)** 구역에 남기고 재계산(4.4) | frame에만 붙이는 규칙 |
| 일괄 | GitHub: Start a review로 모아 한 번에 제출(알림 1회). Artifacts: 입력창 위 대기 코멘트 트레이 | Send all(10개 상한) | 트레이 `N saved · Send all`(UI 문서 5.3), 결과 정직하게(4.5) | 코멘트별 담당자, issue 만들기 |
| 알림 | Figma: 인앱 항상, 이메일 선택(Everything/Mentions/Nothing) | 토스트 | 핀·탭·필름스트립 점, 질문은 별도 문구(4.7) | 이메일·Slack |
| 키보드 | Figma C/Shift+C, Docs R/J/K/E/U, Artifacts Return 게시 후 답글 필드로 포커스 | C, Shift+C, J/K/E/Delete | `R`(답글), 게시 뒤 포커스가 답글 필드로(UI 문서 10절) | - |

## 2. 새 생명주기 (사용자의 말)

사용자에게 보이는 상태는 5개다. 서버에는 상태 열거형이 없고(감사 1.1) 필드 조합에서 계산하는 방식을 **유지**하되, 계산을 한 순수 함수 `lifecycle(comment, ctx)`(`app/src/lib/comment-state.ts`, DOM 없음, 서버와 화면이 같이 씀)로 모은다. `ctx`는 `{channel, flow, now}`다.

```
            ┌───────────── Reopen / Ask again ─────────────┐
            ▼                                               │
  ┌───────┐ Send ┌──────┐ Claude  ┌─────────┐ reply ┌───────────┐  Resolve  ┌──────────┐
  │ Saved ├─────►│ Sent ├────────►│ Working ├──────►│  Replied  ├──────────►│ Resolved │
  └───┬───┘      └──┬───┘  ack    └────┬────┘       │ (done or  │           └────┬─────┘
      ▲   Cancel    │ Stalled?          │ Stalled?   │ question) │◄───────────────┘
      └─────────────┴───────────────────┘            └─────┬─────┘      Reopen
                 Cancel / Resend                           │ 사용자 후속 답글 = 새 turn
                                                           └──► Saved (스레드의 다음 turn)
  Unverified: 어느 상태와도 겹치는 배지(서명 없음). Trust 전에는 Saved에서 못 나간다.
```

- **turn**: 스레드의 한 번의 "사용자 메시지 → Claude 답" 묶음. 상태는 **가장 최근 turn**으로 정해진다. 코멘트가 처음 만들어질 때가 turn 0이고 사용자가 후속 답글을 달면 새 turn이 열려 상태가 Saved로 돌아간다(보류 또는 즉시 전송).
- **막힘은 상태가 아니라 이유**다. Saved 항목은 이유를 한 줄로 말한다: `Saved · Claude is not connected` / `Saved · Paused` / `Saved · Limit reached, resumes 14:05` / `Saved · Waiting for you to send`(보류). 이유가 없으면(곧 전송될 것) `Saved · Sending…`.
- **Stalled**(새로 드러내는 상태): Sent인데 ack가 2분 넘게 없고 채널이 끊겼거나 재연결이 있었던 경우, Working인데 reply 없이 10분 넘게 지난 경우. 항목에 `Claude may have stopped · Resend · Cancel`을 보인다. 시간 기준은 표시용이고 서버 상태를 바꾸지 않는다(4.3).
- **Resolved**는 사용자만 만든다(Claude는 하지 않는다: Artifacts도 Claude가 resolve할 수 있는 건 활성화된 스레드에 한정). Reopen하면 직전 상태(보통 Replied)로 돌아가고 후속 답글이 가능하다.

화면 이름과 내부 필드의 대응:

| 화면 | 조건(최근 turn) |
|---|---|
| Saved | 사용자 메시지가 있고 `deliveredAt` 없음(held 또는 waiting) |
| Sent | `deliveredAt` 있음, `ackAt` 없음 |
| Working | `ackAt` 있음, Claude 메시지 없음 |
| Replied | Claude 메시지가 마지막. `kind: question`이면 `Needs your answer` 부제 |
| Resolved | `resolved` |
| Unverified(배지) | 사용자 메시지의 서명이 없거나 틀림 |
| Detached(배지, 4.4) | 앵커를 잃음 |

## 3. 사용자에게 물을 결정 (질문 카드 후보)

추천을 먼저 둔다. 각 결정은 아래 4~7절의 어느 부분을 고정하는지 적었다.

1. **보내기 기본**: (A, 추천) 채널이 연결돼 있으면 `Enter`=Send, 연결 안 됨이면 `Enter`=Save(연결되면 자동 전송), `Save for later`는 보조 단추(묶음 작성). 마지막 선택을 기억하지는 않는다. (B) 지금처럼 Enter=Add, Cmd+Enter=Send now(문구만 `Save`/`Send`로). *근거: Held가 쌓여 "왜 아무 일도 없지"가 되는 문제(감사 4.3), Docs/Figma의 즉시 전송 습관, Artifacts의 Send to Claude 체크박스(기본 선택, 기억).* → 4.1, UI 문서 5절
2. **스레드**: 사용자 ↔ Claude 대화를 한 코멘트 아래 잇는다(추천) vs 지금처럼 코멘트당 답 하나. → 4.2
3. **Claude의 질문**: 답에 `question` 종류를 두고 일괄 해결에서 빼며 알림 문구를 따로(추천) vs 지금처럼 구분 없음. → 4.2, 4.7
4. **멈춘 요청**: `Stalled` 표시와 `Resend`/`Cancel` 단추를 준다(추천). 시간 기준은 Sent 2분, Working 10분(바꿀 수 있게 상수로). → 4.3
5. **읽음 저장 위치**: 서버에 코멘트별 `seenAt`(기기 간 공유, 추천) vs 이 기기만(localStorage). 한 사용자 앱이라 서버가 단순하다. → 4.7
6. **해결한 코멘트의 핀**: 숨김(Figma, 추천) vs 흐리게 남김(지금). `Show resolved`로 다시 보인다. → UI 문서 4절
7. **앵커를 잃은 코멘트**(Detached): 구역에 남기고 Send all·자동 전달에서 제외, 사용자가 `Re-anchor`/`Dismiss`(추천) vs 지금처럼 삭제된 슬라이드는 그냥 둠. → 4.4
8. **스레드 팝오버를 기본 상호작용**으로(캔버스에서 읽고 답하고 해결, 패널은 훑기용) vs 패널이 기본. → UI 문서 4절
9. **Shift+C**: 지금처럼 코멘트 모드 토글(추천, 이미 쓰는 습관) vs Figma처럼 코멘트 표시 토글(모드는 다른 키). → UI 문서 13절
10. **서명**: Claude의 reply와 사용자의 후속 메시지에도 서명(추천, 기존 comments.json 호환 유지) vs 서명 확장 없음. → 4.6

## 4. 동작 설계

### 4.1 보내기 모델

- 연결 상태에 따라 기본이 바뀐다(결정 1-A): 입력창 아래 한 줄 `● Connected · Enter sends` 또는 `○ Not connected · Enter saves`. 단추는 `Save for later`와 `Send`(연결 안 됨이면 `Save`가 기본, `Send` 눌러도 저장되고 연결 때 전송된다고 한 줄로 알림). 단축키 힌트는 툴팁으로 내리고 입력창 아래는 상태 한 줄만(UI 문서 5.2).
- `Save for later`(= 서버 `held`)로 만든 것은 트레이 `N saved · Send all`(UI 문서 5.3)에서 한꺼번에 또는 하나씩(`Send`) 보낸다. **개별 `Send` 동작**을 새로 둔다(감사 3.6: Waiting 1~2개는 보낼 길이 없었다): `POST /api/comments/:id/send`.
- Send all 결과는 정직하게(4.5). 영역 코멘트의 이미지 최대 5초 대기와 상한 10개는 그대로.
- 작성창 오류는 서버 사유를 보인다(`Could not send: <reason>`; 키 오류의 해결 안내가 가려졌던 문제, 감사 4.3).

### 4.2 스레드

데이터(호환 우선, 기존 필드를 지우지 않는다):

- 코멘트 루트의 기존 필드가 **turn 0**이다: `text`(사용자), `reply`/`repliedAt`(Claude), `held`/`deliveredAt`/`ackAt`, `editBase`/`editHash`/`revertedAt`.
- 후속은 새 배열 `thread?: Msg[]`(최대 40개). `Msg = { id, from: "user"|"claude", text, at, kind?: "done"|"question", held?, deliveredAt?, ackAt?, changed?: {slide, excerpt}[], editBase?, editHash?, revertedAt?, sig? }`. 사용자의 메시지는 `held`, `deliveredAt`, `ackAt`을 **자기 turn의 전달 상태**로 가진다.
- `turns(c)`가 루트와 `thread`를 한 줄 목록으로 펴 준다. 화면과 서버가 같은 함수를 쓴다.

흐름:

- 사용자가 스레드에서 답글을 보내면 `POST /api/comments/:id/messages {deck, text, hold?}`가 서명된 user 메시지를 붙이고 `comment` 이벤트를 보낸다. 채널 알림은 지금과 같은 틀에 `history`(이전 메시지 최대 6개, 각 2000자, JSON 데이터)를 더해 Claude가 대화를 본다. 알림의 신뢰 규칙(text만 지시, history·excerpt·path·이미지 글자는 데이터)은 그대로다.
- `reply` 도구는 `{id, text, ask?: boolean}`: `ask:true`면 `kind:"question"`(Claude가 되묻는 경우), 아니면 `done`. 마지막 turn이 아직 답 전일 때만 받는다(이미 답했으면 지금처럼 409 `already replied`). 첫 답은 지금처럼 루트 `reply`에도 쓴다(호환).
- 질문은 **Replied** 안의 `Needs your answer`이고 일괄 해결(`Resolve all replied`)에서 빠진다. 사용자가 답글을 달면 새 turn이 열려 Saved→Sent로 간다. `Ask again`은 같은 스레드에 "Please try again." 메시지를 하나 더 보내는 단축이다(Claude가 이전 시도를 보고 판단).
- Revert: 지금처럼 **한 turn의 Claude 수정**을 되돌린다(`editBase`는 그 turn의 것). 겹치는 turn(묶음 알림에서 ack~reply 창이 겹치는 문제, 감사 3.10)은 지금의 시간 창 방식을 turn별 `slidekit_edit` 기록으로 바꿀 수 있다: `slidekit_edit`이 호출 때 `comment_id`(선택)를 받아 그 turn의 `editBase`를 정확히 기록(4.8).
- 상한·Pause(M5)에는 **사용자 turn마다** 전달 시각이 들어간다(각 user 메시지의 `deliveredAt`이 사용량에 합산).

### 4.3 멈춘 요청

- 서버는 시간 경과를 상태로 만들지 않는다. UI가 `now - deliveredAt`/`ackAt`으로 `Stalled`를 표시한다(2분/10분, `Claude not connected`와 겹치면 문구 합침: `Claude disconnected · Resend · Cancel`).
- `Resend`(`POST /api/comments/:id/resend`): 그 turn의 `deliveredAt`과 `ackAt`을 지우고 `comment` 이벤트를 보낸다(채널은 `pushed`에 이미 있으므로 `force` 표시가 있는 이벤트는 다시 전달하며, 같은 id의 알림이 두 번 가도 `ack`·`reply`가 한 번만 받는다는 점으로 안전하다).
- `Cancel`(`POST /api/comments/:id/cancel`): 그 turn을 Saved(보류)로 돌리고 `cancelledAt`을 붙인다. Claude가 이미 일하고 있었다면 그 뒤 `reply`는 409 `withdrawn`을 받고, 채널 도구 설명이 "withdrawn이면 이미 적용한 수정은 그대로 두고 사용자에게 알린다"를 말한다(수정은 Revert로). 취소는 Claude를 멈추지 못한다는 점을 UI가 숨기지 않는다: `Cancelled. Claude may still finish what it started.`
- **채널 재연결 때 backfill 확장**: `!deliveredAt`뿐 아니라 "ack도 reply도 없는 `deliveredAt`(마지막 채널 연결 끊김 이전)"을 한 번 다시 보낸다. 새 세션이 이전 세션이 받고 죽은 요청을 이어받는다(감사 3.1의 핵심).
- `get_pending`은 지시문이 "시작할 때 한 번" 부르게 한다(지금은 "더 있다" 알림 때만).

### 4.4 앵커

- **저장 때만 하던 remap을 모든 덱 변경으로 넓힌다.** `slidekit_edit`, 파일 감시(직접 수정), 버전 복원이 덱을 바꿀 때마다 서버가 전후 슬라이드를 맞춘다: 슬라이드 본문 해시의 LCS로 대응을 구하고(이동·삽입·삭제), 남은 옛 슬라이드는 `excerpt` 포함 여부로 보조 대응한다. 대응이 나오면 `slide`를 갱신(`moved`), 못 찾으면 `anchor: "lost"`.
- `anchor`는 **저장된 영구 플래그가 아니라 매번 계산하는 값**이다(`slideDeleted`와 `recheck`를 대체). 그래서 실행 취소·복원으로 슬라이드가 돌아오면 자동으로 `ok`가 된다(감사 3.5 "영구" 문제). 기존 `slideDeleted`와 `recheck` 필드는 읽을 때 무시하고 쓰지 않는다.
- 발췌 비교는 `slide-edit.ts`의 `visible`과 같은 정규화(엔티티 풀기, 인라인 태그는 공백 없이, `script`·`style`·노트 제외)를 쓴다(감사의 `flagAfterRestore` 오탐 원인 제거). Replied, Resolved도 검사한다. 빈 `excerpt`는 슬라이드 번호 대응만 본다.
- **Detached 구역**: 앵커를 잃은 코멘트는 패널의 `Detached` 구역(Figma의 "분리되지만 사이드바에 남는다"와 같다)에 모이고 핀이 없다. 항목에 `This comment lost its place on the slide` 한 줄과 `Re-anchor`(슬라이드와 요소를 골라 다시 붙임)와 `Dismiss`(Resolved로) 단추. 자동 전달(backfill, `get_pending`, Send all)에서 빠지고 사용자가 직접 `Send`하면 알림에 `anchorLost:true`가 실려 Claude가 위치를 추측하지 않고 묻는다.
- 같은 요소에 여러 코멘트: 개별 알림 경로에도 "같은 요소의 다른 열린 코멘트가 N개 있다(`related`: 코멘트 id와 요약, 데이터)"를 싣고 충돌 조정 안내를 batch와 같게 한다(감사 3.4).

### 4.5 일괄 전송과 개별 전송 결과

- `POST /api/comments/send-all`의 응답을 `{sent, waiting, reason: null|"paused"|"limit"|"disconnected", resetAt?}`로 늘린다(서버가 flow와 채널 연결을 보므로 가능). 토스트는 그대로 말한다: `Sent 3 to Claude` / `Saved 3. Claude is paused, they send when you resume.` / `Sent 4, 2 waiting for the limit (resumes 14:05)`.
- 일부만 갔을 때 코멘트별 상태는 항목의 이유 한 줄(2절)이 보여 준다.
- Send 버튼은 진행 중 비활성(이중 클릭과 최대 5초 대기 표시: `Waiting for the picture…`).

### 4.6 서명과 신뢰

- `Trust all (N)`: 패널에서 Unverified가 2개 이상이면 한 단추(확인 한 번: `Trust N comments on this deck? They will be sent to Claude.`). 서버 `POST /api/comments/trust-all {deck}`.
- Trust한 코멘트가 보류였으면 `Saved · Waiting for you to send`로 이유를 말한다(지금은 말없이 Held).
- **Claude의 reply도 서버가 서명**한다(`sig` over `[deck, id, msgId, kind, text, at]`). 서명 없는 외부 reply는 `Unverified reply`로 보이고 `Replied` 상태를 만들지 않는다(감사 3.8의 위조 가능성 제거). 서명 대상 배열은 새 필드에만 확장되므로 기존 코멘트와 서명은 그대로 검증된다.

### 4.7 읽음과 알림

- `seenAt`(코멘트별, 서버): 스레드를 열거나 패널에서 펼치면 `POST /api/comments/:id/seen`. 안 읽음 = 마지막 Claude 메시지의 `at` > `seenAt`. `Mark as unread` 제공.
- 알림은 한곳(aria-live 하나)에서: `Claude replied on slide 3 · View`, 질문은 `Claude has a question on slide 3 · Reply`(구분), Stalled는 토스트 없이 항목에만. 핀 점, 패널 탭 점, 필름스트립 타일 점(UI 문서 8절).
- `Working` 전이도 읽어 준다(`aria-live`: `Claude started on comment 3`).

### 4.8 에이전트 쪽 변경(채널과 지시문)

- 도구: `reply`에 `ask?`; `slidekit_edit`에 `comment_id?`(그 turn의 `editBase` 정확 기록); 새 도구는 만들지 않는다(Resolve·Resume 도구 없음 원칙 유지).
- 지시문: ack 규칙을 하나로(`작업을 시작하면 ack, 질문이나 거절만이면 ack 없이 reply`로 도구 설명과 맞춘다, 감사 3.10), 질문은 `ask:true`, 후속 알림의 `history`는 맥락 데이터임을 한 줄, `withdrawn`을 받으면 처리, `get_pending`은 시작 때 한 번.
- 알림 틀의 프롬프트 주입 방어(excerpt, path, history, related, 이미지 글자는 데이터)를 유지하고 시험을 늘린다(history에 `</channel>`).

### 4.9 SSE와 안정성

- 편집기는 SSE가 다시 연결되면 코멘트 목록을 다시 받는다(감사 3.11). 서버 재시작 뒤 낡은 화면이 없어진다.
- 구독자 상한(20)에 맞게 편집기 탭당 연결을 하나로 모으는 일은 별도 작업(현재 탭당 3~4개)이다. 이 설계가 새 연결을 늘리지 않는다.
- 영역 이미지 `pending`이 서버 재시작 뒤 영구로 남는 문제는 서버 시작 때 `pending`을 `failed`로 정리해 해결(감사 3.9).

## 5. 화면 (editor-dev의 `COMMENT-UX-UI.md` 요약과 이 문서와의 접점)

- 핀: 말풍선, 번호 항상 표시, 해결은 숨김(`Show resolved`), 같은 요소는 개수 배지, 호버 미리보기(150ms). **핀 상태 구분**(Saved 윤곽, Sent·Working 채움(Working 호흡), Replied 초록+안읽음 점, Unverified 방패, Detached `?`).
- 스레드 팝오버(핀 클릭): 머리줄(번호, 진행 점 4개, 상태, 시간, `⋯`), 인용, 메시지 목록, 답글 입력(`Reply to Claude`, 연결 안 됨이면 `Save reply`), `Resolve`. Claude 수정이 있으면 `Changed slide 3 · Revert · Show change`(존재 효과 재사용).
- 패널: 머리 한 줄(제목, 연결 점, `⋯`: Pause, Show resolved, Sort), 고정 폭 필터 `All · Open · Unread · Resolved`+`This slide`+검색, 카드는 한 줄 요약+마지막 답 미리보기+이유 한 줄, 하단 트레이 `N saved · Send all`. `Detached`와 `Resolved`는 구역.
- 막힌 이유 한 줄이 `FlowBar`와 `ChannelBadge`의 일을 흡수한다(`Paused (Resume)`, `Limit reached, resumes 14:05`, `Not connected (How to connect)`).
- 모바일: 바텀 시트(목록 ↔ 스레드), 터치 타깃 44px.

아래 스케치 둘은 이 문서의 새 요소다(핀과 팝오버 스케치는 UI 문서 4절).

```
카드(패널, 한 줄 요약)                               Stalled와 질문
┌───────────────────────────────────────────┐     ┌───────────────────────────────────────────┐
│ ③ ●●○○ Sent       Slide 3 · 4 min ago   ⋯ │     │ ⑤ ●●●● Replied · Needs your answer      ⋯ │
│ Make this shorter                          │     │ Use the blue theme                         │
│ ⚠ Claude may have stopped                  │     │ ✦ Claude: Which blue, brand or accent?     │
│   [Resend] [Cancel]                        │     │ ● unread      [Reply] [Resolve ✓]          │
└───────────────────────────────────────────┘     └───────────────────────────────────────────┘

작성창(연결됨)                                     Send all 결과 토스트
┌ Comment on "Quarterly results" ────────────┐    ┌──────────────────────────────────────────────┐
│ Tell Claude what to change…                │    │ Sent 4 to Claude. 2 waiting for the limit    │
│ ○ Make this shorter ○ Simplify             │    │ (resumes 14:05).                    [View]  │
│ ● Connected · Enter sends  [Save later][Send]    └──────────────────────────────────────────────┘
└────────────────────────────────────────────┘
```

## 6. 접근성

- 상태는 색이 아니라 **채움 개수와 글자**(진행 점 4개 `aria-label`: `Step 3 of 4: Claude is working`), 이유는 글자.
- 스레드 팝오버는 비모달 `role="dialog"`, 메시지는 `role="list"`, 읽지 않음 `aria-label="Unread reply"`. 상태 변화 알림은 한 `aria-live=polite`(지금 FlowBar와 ChannelBadge가 각각 status라 소음, 감사 4.5)로 모은다.
- 핀은 roving tabindex 한 정지, `N`/`P`로 이동, `Enter`로 팝오버, `R` 답글, `E` 해결, `U`/`Esc` 닫기. 파괴 동작(Delete)은 확인 없이 지우되 Undo 토스트(감사 3.12)를 유지하고 토스트 큐가 Undo를 밀어내지 않게 Undo 토스트는 우선 보존.
- 움직임 줄이기: Working 호흡과 부채꼴 전환 없음.
- Stalled, Detached, 질문은 색이 아니라 아이콘+글자.

## 7. 성능

- `lifecycle`과 `turns`는 순수 함수, 코멘트 300개와 스레드 40개 이하에서도 항목당 O(turn).
- M5 사용량 계산(`currentFlow`)이 전달마다 모든 덱의 코멘트를 읽는다. 스레드로 전달 시각이 늘면 비용이 커지므로 서버 시작 때 만든 메모리 인덱스(전달 시각 목록)를 `delivered`·삭제 때 갱신하는 방식으로 바꾼다(구현 3단계).
- 앵커 재계산은 덱이 바뀐 뒤(디바운스 250ms) 슬라이드 해시 비교 한 번. 코멘트가 없는 덱은 건너뜀. 큰 덱(80장)에서 해시 계산은 이미 `changedSlides`가 같은 규모로 한다.
- 패널 목록은 `content-visibility:auto`, 펼침 스레드는 열 때 마운트(UI 문서 11절).

## 8. 마이그레이션과 호환

- `comments.json`은 **추가 필드만** 늘린다(`thread`, `seenAt`, `cancelledAt`, Claude 메시지의 `kind`, `sig`). 기존 필드와 의미를 바꾸지 않는다. `slideDeleted`와 `recheck`는 읽기만 하고 무시한다(앵커는 계산).
- 서명: 루트의 서명 대상 배열은 그대로라 기존 코멘트가 계속 검증된다. 새 메시지는 같은 키로 `[deck, id, msgId, from, kind, text, at]`을 서명한다(`sig` 없는 `thread` 항목은 `Unverified`).
- 이전 서버가 새 파일을 읽으면 `sanitize`가 알 수 없는 필드를 버리므로 **후속 메시지만 사라지고** 코멘트와 루트의 답은 남는다(다운그레이드 안전).
- 채널 알림은 새 필드(`history`, `related`, `anchorLost`)를 더하기만 한다. 이전 채널 프로세스는 무시한다.
- 상태 이름은 UI만 바뀐다. 시험이 기대하는 `data-state`(`held`, `waiting`, `sent`, `working`, `replied`, `resolved`, `unverified`) 값은 유지하고 화면 문구만 5개로 줄이는 매핑을 `STATE_LABEL`에서 한다(기존 e2e 호환).

## 9. 구현 분해 (결정 뒤)

| 단계 | 내용 | 소유 | 규모 | 먼저 필요한 결정 |
|---|---|---|---|---|
| 1 | 정직한 상태: `lifecycle` 순수 함수, 항목별 막힘 이유 한 줄, Send all 결과 `{sent,waiting,reason}`, 개별 `Send`, SSE 재동기화, 지시문 모순(ack) 정리, `pending`→`failed` 정리, 서버 사유 표시 | channel-dev(서버·채널·문구) + editor-dev(항목 표시) | 중 | 4(Stalled 기준), 1(문구) |
| 2 | 멈춤 복구: Stalled 표시, `Resend`/`Cancel`/`withdrawn`, 재연결 backfill 확장, `get_pending` 시작 시 호출 | channel-dev, editor-dev(단추) | 중 | 4 |
| 3 | 스레드: `thread`·`messages` API·서명, `reply ask`, 알림 `history`, Revert의 turn 단위 `comment_id`, `Resolve all replied`에서 질문 제외, M5 사용량 인덱스 | channel-dev(데이터), editor-dev(팝오버, 답글 입력) | 큼 | 2, 3, 10 |
| 4 | 앵커: 모든 덱 변경에서 대응 계산, `anchor` 계산값, `Detached` 구역과 `Re-anchor`/`Dismiss`, 정규화 통일, `related`/`anchorLost` | channel-dev(서버), editor-dev(구역, 재앵커 UI) | 중 | 7 |
| 5 | 읽음·알림: `seenAt`, 안 읽음 점(핀, 탭, 타일), 질문 알림 문구, 정렬 | channel-dev(필드), editor-dev(표시) | 작음~중 | 5 |
| 6 | 신뢰: `Trust all`, Claude reply 서명 | channel-dev | 작음 | 10 |
| 7 | 핀과 패널 재구성(말풍선, 클러스터, 호버, 팝오버 레이아웃, 트레이, 바텀 시트, 핀 드래그) | editor-dev | 큼 | 6, 8, 9 |

1과 2는 기존 모델 위의 고침이라 3(스레드)보다 먼저 가치가 있다(감사의 1, 5, 7번과 멈춤 문제). 7은 3과 독립으로 진행할 수 있다(스레드 데이터가 없으면 팝오버는 읽기와 해결만).

## 10. 시험 계획

- 단위: `lifecycle`(모든 필드 조합 → 상태·이유·Stalled), `turns`, 앵커 대응(LCS, 삽입·삭제·이동·복원 왕복, 인라인 태그와 엔티티 정규화), 서명(루트 호환, 새 메시지, 위조 reply), `sanitize`의 `thread` 처리와 다운그레이드.
- 채널 통합(`channel/*`): 질문 `ask` 왕복, 후속 알림의 `history`·`related`·`anchorLost`와 틀 위조 방어, `Resend`와 재연결 backfill(죽은 세션 이어받기), `Cancel`+`withdrawn`, Send all 결과 모양, M5 상한과 thread 전달 합산.
- 브라우저: 항목 이유 한 줄, Stalled와 Resend, 스레드 답글 키보드 흐름, Detached 구역, Trust all, 읽음 점, a11y(axe, 키보드), perf(코멘트 300개+스레드).
- 기존 시험은 `data-state` 값과 흐름이 그대로라 변경 없이 통과해야 한다.

## 11. 합격 기준

- 세션이 죽어도 어떤 코멘트도 Sent·Working에 갇히지 않는다(Stalled 표시와 Resend/Cancel, 재연결 이어받기).
- Claude의 질문에 사용자가 같은 코멘트에서 답하고, Claude가 이전 대화를 본 채 이어서 답한다.
- Claude가 슬라이드를 옮기거나 지워도 코멘트가 따라가거나 Detached 구역에 남고 실행 취소하면 돌아온다.
- Send all과 개별 Send의 결과 문구가 실제와 같다(Pause, 상한, 미연결).
- 기존 `comments.json`과 서명이 그대로 열리고, 기존 코멘트 e2e가 바뀌지 않고 통과한다. 새 의존성 0.
