# slidekit 코멘트 시스템 감사 (코드만 읽음)

범위: app/comments.ts, app/comment-flow.ts, channel/index.ts, app/src/lib/{comment-state,use-comments-live,comment-flow,comment-actions}.ts, CommentsPanel/Composer/ModeLayer/Pin/ReplyToasts, Canvas 핀 부분, Editor의 postComment/jump, 스펙 4종, HANDOFF.
표기: [사실] = 코드로 확인, [의견] = 판단, [확인 필요] = 코드만으로 단정 못 함. 실행은 하지 않았다.

---
## 1. 상태

### 1.1 저장 필드 (comments.ts:16-43)
status(open|done), reply/repliedAt, held, deliveredAt, ackAt, resolved/resolvedAt, editBase/editHash, revertedAt/revertUndo, sig(trusted는 읽을 때 계산 :205), slideDeleted, recheck, image(pending|ready|failed, region 코멘트만 :189), region/overlap/step.
서버에는 "상태" 열거형이 없다. UI의 stateOf 한 줄(comment-state.ts:7-8)이 필드 조합을 우선순위로 접어 이름을 만든다.

### 1.2 stateOf 우선순위와 이름
순서: resolved > status=done > trusted===false > ackAt > deliveredAt > held > (그 외)

| UI 이름(STATE_LABEL) | 필드 조합 | 비고 |
|---|---|---|
| Resolved | resolved=true | 다른 모든 필드를 가린다. 답 전/후 무관 |
| Replied | status=done (resolved 아님) | 완료 답, 질문, 거절 모두 같은 이름 |
| Unverified | status=open, trusted=false | 전달 안 됨. Trust로만 탈출 |
| Claude is working | open, ackAt 있음 | deliveredAt 유무 무관 |
| Sent to Claude | open, deliveredAt 있음, ackAt 없음 | |
| Held | open, held=true, 전달 전 | Add(Enter)가 만든다 |
| Waiting | open, 위에 모두 해당 없음 | 채널 미연결, Pause, 상한, Send all 대기 모두 "Waiting" |

stateOf에 안 나타나는 보조 조건(표시가 따로이거나 아예 없음):

| 조건 | 어디에 보이나 |
|---|---|
| slideDeleted | 패널의 "Deleted slides" 그룹 제목뿐. 항목 배지는 Waiting/Held 등 그대로 (CommentsPanel.tsx:136,192). 핀 없음 (Editor.tsx:976) |
| recheck | 패널 항목의 문장 한 줄 (CommentsPanel.tsx:229). 핀과 필터에는 없음 |
| image pending/ready/failed | 패널 항목의 "Making a picture..." / 썸네일 / "No picture..." (:220-227) |
| editBase 있음 + reply | "Revert Claude's edit" 줄 (:241). revertedAt이면 "Undo revert" |
| trusted 미정(undefined) | 낙관적 upsert 직후 한 순간 (Editor.tsx:721). stateOf는 trusted===false만 unverified로 봄 |
| 채널 연결/Flow(Pause, 상한) | 코멘트 상태가 아니라 패널 머리 ChannelBadge와 FlowBar |

### 1.3 전이표 (file:line)

| 동작/이벤트 | 전 | 후 | 위치 |
|---|---|---|---|
| 작성 Add(Enter) | - | open, held, trusted(서명) | comments.ts:309,314; Composer.tsx:71,87 |
| 작성 Send now(Cmd+Enter) | - | open, Waiting -> (채널 있고 상한 아래면) Sent | comments.ts:317 emit("comment"); channel push :186-205 |
| 영역 코멘트 작성 | - | 위와 같고 image=pending. 5초 또는 이미지 완료 뒤에야 "comment" 이벤트 | comments.ts:318-327 |
| 캡처 끝 | image=pending | ready / failed | applyImage :229-237 |
| 채널 push 성공 | Waiting | Sent (deliveredAt) | channel :204 -> markDelivered -> comments.ts:497-511 |
| 채널 연결/재연결 backfill | Waiting(미전달, trusted, held 아님) | Sent. 10개씩, 나머지는 "더 있다" 알림 1회 | channel :237-250 |
| get_pending 호출 | open(held, resolved 제외) | 전달 안 된 것에 deliveredAt 찍음 | channel :102-110,116-130 |
| Send all | Held/Waiting(trusted, 미전달, slideDeleted 아님) | held 해제 + (채널 있으면) batch 전달 -> Sent. 10개 상한 | comments.ts:463-481 |
| ack | Sent/Waiting(open, ackAt 없음) | Working (ackAt) + agent.edit.start | comments.ts:411-426 |
| reply | open (Working/Sent/Waiting/Held 아무거나) | Replied (status=done, editBase/editHash 연결) | comments.ts:331-349 |
| reply (이미 done) | done | 409 거절 | :339 |
| Resolve | 임의 | Resolved (resolved=true) | :514-528 |
| Reopen | Resolved | resolved만 지워서 직전 상태로. 답이 있었으면 Replied, 없었으면 Waiting/Sent/... | :523 |
| Trust | Unverified | 재서명. open이고 미전달이면 "comment" 이벤트로 전달 시도 (held면 channel이 거름) | :352-365 |
| Revert Claude's edit | Replied(editBase) | 상태 불변. revertedAt, 덱 복원 | :369-399 |
| Undo revert | 위 | revertedAt 삭제 | :381-385 |
| Delete | 임의 | 목록에서 제거 (서버 메모리 50개 보관) | :428-443 |
| Restore (Undo 토스트) | 삭제됨 | 되살림, image가 있었으면 failed | :444-460 |
| 저장 시 slideMap(remap) | 임의 | slide 번호 갱신 또는 slideDeleted=true (한 번 true면 영영 건너뜀 :565) | :560-574, editor-api.ts:54 |
| 버전 복원 | open | 발췌문 못 찾으면 recheck=true | :577-590, versions.ts:193 |
| 키 파일 삭제/손상 | 전부 | 전부 Unverified (verify 실패 :115-119) | |
| Pause / 상한 | Waiting 유지, 전달만 막힘 | Resume/풀림 시 backfill | channel :184,193,271-276 |

---
## 2. 상태별로 할 수 있는 것

패널 버튼과 단축키 기준. "에이전트" 칸은 채널 도구(ack, reply, get_pending, slidekit_edit)와 channel 전달 규칙.

| 상태 | 사용자 가능 | 사용자 불가 | 에이전트 가능 | 에이전트 불가 |
|---|---|---|---|---|
| Held | Send all(묶음), Resolve, Delete, 이동 | 개별 Send, Hold 해제, 수정(본문 편집 없음) | reply/ack는 서버가 막지 않음(알림이 안 오므로 사실상 불가) | 자동 전달 안 됨. get_pending에서 제외 (channel :107) |
| Waiting | Send all(3개 이상일 때만 버튼), Resolve, Delete | 개별 Send(버튼 없음), "왜 대기 중인지" 확인 | 채널 연결+상한 아래면 받음 | Pause/상한/미연결이면 못 받음 |
| Sent to Claude | Resolve, Delete | 취소, 재전송, 회수 | ack, reply, get_pending에 계속 나옴 | 자동 재전달 없음 |
| Claude is working | Resolve, Delete | 취소, 재전송 | reply, slidekit_edit | 중도 포기를 알릴 도구가 없다(reply만 있음) |
| Replied | Resolve, Resolve all replied(2건 이상), Revert(editBase 있을 때), Delete | 후속 질문(스레드 없음), 재요청 | 불가 (reply 409) | reply 덮어쓰기 |
| Resolved | Reopen, Delete | - | 열린 코멘트면 reply는 아직 가능 | |
| Unverified | Trust, Resolve, Delete | 일괄 Trust | 안 보임. get_pending은 개수만 안내 | 전달, 처리 |
| slideDeleted(위 상태에 겹침) | Resolve, Delete | 슬라이드로 이동(jump 막힘 Editor.tsx:727), 복구 | backfill/get_pending에는 여전히 나온다(아래 3.5) | |
| recheck(겹침) | 이동(실패해도 조용함) | 확인 완료 표시, 재앵커 | 그대로 받음 | |

---
## 3. 혼란, 모순, 막다른 길, 누락

심각도 상(막다른 길이나 데이터/오작동), 중(혼란), 하(다듬기).

### 3.1 에이전트가 응답 못 하거나 세션이 끊길 때 [상]
- [사실] Sent/Working을 되돌리는 경로가 없다. 서버에 타임아웃, 재전달, 회수가 없고 stateOf에도 시간 개념이 없다 (comment-state.ts:7). 탈출구는 Resolve나 Delete뿐이다.
- [사실] backfill은 `!c.deliveredAt`만 다시 보낸다 (channel :239). 알림을 받은 뒤 세션이 죽으면 새 세션은 그 코멘트를 자동으로 못 받는다. get_pending은 open 전부를 주지만 (channel :107) 지시문이 "더 있다" 알림이 올 때만 호출하라고 해서 (:62) 새 세션이 스스로 부를 이유가 없다.
- [사실] ack는 있고 "ack 취소/포기" 도구는 없다. 배치 10개 중 5개만 reply하고 끊기면 나머지 5개는 Working/Sent로 남는다.
- 재현: 채널 연결, 코멘트 Send now, Claude가 ack 후 세션 종료 -> 패널 "Claude is working"에 스피너가 계속 돈다(StateBadge animate-spin, CommentsPanel.tsx:39). 채널은 `connected:false`로 바뀌지만 (comments.ts:552) 항목 상태는 안 바뀐다.
- [사실] 채널 푸시 실패 경로: `pushed.add`가 notification 전에 실행된다 (channel :194). notification이 던지면 pushed에는 남고 deliveredAt은 안 찍혀 Waiting인 채 그 채널 프로세스가 사는 동안 다시 안 보낸다. [확인 필요] 실제로 notification이 던지는 조건.
- [사실] markDelivered 실패는 삼킨다 (channel :230). 전달은 됐는데 앱에는 Waiting으로 남을 수 있고, 다음 backfill이 pushed 때문에 건너뛰어 영구 Waiting. [확인 필요]
- [사실] 채널 프로세스가 둘 이상(상한 3, comments.ts:533)이면 각자 pushed가 따로라 같은 "comment" 이벤트를 둘 다 받는다. 두 세션이 같은 코멘트를 동시에 처리할 수 있고 두 번째 reply는 409다. [확인 필요] 실제 운용에서 세션 2개를 띄우는지.

### 3.2 Claude 처리 중 취소와 재요청(reopen) [상]
- [사실] 취소 없음. Working 중 Delete나 Resolve를 해도 Claude에는 신호가 안 간다. Claude는 계속 수정하고 reply는 404(삭제) 또는 성공(해결)이다. 삭제된 경우 편집은 적용되고 기록(editBase 연결)은 사라진다.
- [사실] "Reopen"은 이름과 달리 재요청이 아니다. resolved만 지운다 (comments.ts:523). status=done이라 다시 Replied로 돌아가고 reply는 409라 Claude가 다시 처리할 수 없다. 사용자 눈에는 "Reopen -> Replied"로 보여 되살린 것처럼 보이지만 아무도 다시 안 한다.
- [사실] "잘못 고쳤으니 다시"의 정식 경로는 새 코멘트를 쓰는 것뿐이다. Revert는 덱만 되돌리고 코멘트는 Replied로 남으며 reply 문구("제목을 줄였다")는 낡은 채 남는다. 되돌린 뒤 상태 표시는 "Claude's edit was reverted." 한 줄뿐 (CommentsPanel.tsx:244).

### 3.3 답글, 스레드, 후속 질문 [상]
- [사실] reply는 코멘트당 정확히 한 번이다 (comments.ts:339, 도구 설명도 같은 말). 스레드 필드(parent 등)가 Comment 타입에 없다 (grep 결과 없음).
- [사실] Claude가 질문하면(모호하면 reply에 질문, channel :57) 그것도 status=done이라 Replied로 보이고 "Resolve all replied"가 질문까지 일괄 해결한다 (use-comments-live.ts:57). 토스트도 "Claude replied on slide N"으로 질문과 완료를 구분하지 않는다 (ReplyToasts.tsx:17).
- [사실] 후속 답은 새 코멘트로 오는데 (channel :60) 이전 코멘트와 연결이 없다. Claude는 새 알림에서 이전 대화를 못 보고, 사용자는 요소를 다시 골라 처음부터 써야 한다. 패널에도 "Reply" 버튼이 없다. 같은 요소에 붙은 코멘트끼리 묶여 보이지도 않는다(슬라이드별 그룹만, :136).
- [의견] 질문(Needs answer)과 완료(Done)를 상태로 분리하고 Replied 안에서 후속 입력을 받는 편이 지금의 "번호 핀 + 새 코멘트" 흐름보다 일관되다.

### 3.4 번호와 같은 요소 여러 코멘트 [중]
- [사실] 번호는 위치 기반(작성순 index+1)이라 삭제하면 뒤 번호가 당겨진다 (comment-state.ts:21-24). Delete 후 Undo(restore)는 createdAt 정렬로 원래 번호를 되찾지만 (comments.ts:454), 그 사이 사용자가 "코멘트 3"을 말했다면 어긋난다. Claude의 reply 문장에는 번호가 없어 영향은 사용자 쪽 기억뿐. [의견] 상 아님.
- [사실] 같은 path의 핀은 22px씩 옆으로 밀려 나열된다 (Canvas.tsx:672-678). 슬라이드 전체 코멘트(path="")는 모두 같은 자리에 쌓인다. 핀 수십 개면 겹침 처리(묶음 카운트)가 없다. 성능 측정은 핀 100개까지 있음 (HANDOFF:46).
- [사실] 같은 요소를 겨냥한 여러 코멘트는 개별 Send now면 별도 알림(순차), Send all이면 batch로 가며 batch 지시문에만 "충돌하는 요청은 함께 맞춰라"가 있다 (channel :43). 개별 알림 경로에는 충돌 조정 안내가 없다. 같은 요소에 Send now를 연달아 누르면 Claude가 각각 따로 고칠 수 있다.

### 3.5 앵커 소실, 슬라이드 순서 변경, 삭제, 복원 [상]
- [사실] remap은 편집기 PUT의 slideMap에서만 호출된다 (editor-api.ts:54, grep 확인). Claude의 `slidekit_edit`이나 직접 편집, 버전 복원이 슬라이드를 추가/삭제/이동해도 코멘트의 slide 번호는 갱신되지 않는다. 지시문은 "다른 코멘트의 slide 번호를 path와 excerpt로 다시 대조하라"고 하지만 (channel :60) 번호를 고치는 도구는 없다. 앱의 핀은 `origin` 맵(저장 시점 번호) 기준이라 (Editor.tsx:976) 어긋난 코멘트가 엉뚱한 슬라이드에 핀으로 뜬다.
- [사실] slideDeleted는 한 번 켜지면 되돌릴 수 없다 (remap이 `continue`, comments.ts:565). 편집기에서 슬라이드 삭제를 Undo해도 코멘트는 "Deleted slides" 그룹에 영구히 남는다(jump 불가, 핀 없음).
- [사실] 슬라이드 삭제 후에도 backfill과 get_pending은 slideDeleted를 거르지 않는다 (channel pending() :107에 조건 없음). Send all은 거른다 (comments.ts:468). 즉 같은 코멘트가 경로에 따라 전달되거나 안 된다. 재현: 채널 끈 채 코멘트 작성 -> 그 슬라이드 삭제 후 저장 -> 채널 연결 -> backfill이 옛 slide 번호로 전달 (번호는 갱신 안 됨, 삭제 슬라이드는 번호 유지). [의견] 정확한 영향은 Claude가 excerpt로 맞추는지에 달림.
- [사실] flagAfterRestore (comments.ts:577-590)의 한계:
  - open 코멘트만 검사한다 (:583). Replied/Resolved는 표시 안 함.
  - excerpt가 빈 코멘트(슬라이드 전체, 글자 없는 영역)는 영영 recheck가 안 된다 (:584).
  - 슬라이드 본문을 `<[^>]+>`를 공백으로 바꿔 만든다 (:579). 인라인 태그가 있으면 textContent와 달라진다. 예: `Hello <b>wor</b>ld`는 "Hello  wor ld"가 되어 excerpt "Hello world"를 못 찾는다. `&amp;` 같은 엔티티도 textContent의 `&`와 안 맞는다. 둘 다 앵커가 멀쩡해도 recheck가 켜질 수 있다. [확인 필요] 실제 덱에서의 빈도(인라인 강조가 많은 덱이면 높음).
  - notes(aside)와 style/script 텍스트도 슬라이드 글에 섞여 들어가 반대로 소실을 놓칠 수 있다 [의견].
  - 슬라이드 번호 재배열은 확인하지 않고 같은 번호 슬라이드만 본다.
  - 복원 후 recheck가 켜진 코멘트도 그대로 전달된다. 해제 수단(Dismiss, Re-anchor)이 없다.
- [사실] 앵커 소실 시 jump는 조용하다: `pickSel(byPath(...) ?? null)` (Editor.tsx:729) 선택만 풀리고 알림이 없다. 핀은 `display:none` (Canvas.tsx:680)이라 사라지고 패널에서만 보인다.
- [사실] 삭제 Undo(restore)는 remap을 다시 돌리지 않아 그 사이 슬라이드가 바뀌면 slide 번호가 낡는다. 서버 메모리 보관이라 서버 재시작 후 Undo는 404 (comments.ts:450) -> "Could not restore" 오류만 표시된다.

### 3.6 일괄 전송 결과 표시 [중]
- [사실] Send all 토스트는 항상 "Sent N comments to Claude" (use-comments-live.ts:51). 서버는 채널이 없어도 (comments.ts:475), Pause나 상한이어도 held만 풀고 count를 돌려준다. 이때 코멘트는 Waiting이 되어 실제로는 안 갔는데 "Sent"로 알린다. 서버는 flow를 보지 않는다 (flow는 channel만 본다).
- [사실] 결과가 코멘트별로 보이지 않는다. 일부만 전달(상한 남은 수, :212)돼도 토스트는 N개로 말한다. 10개 상한 때만 "N more waiting, press Send all again".
- [사실] 이미지가 pending이면 요청이 최대 5초 블록된다 (:476). UI에 진행 표시가 없다 (버튼 비활성도 없음, 이중 클릭 가능. 두 번 눌러도 deliveredAt/pushed로 중복은 막힘 [확인 필요]).
- [사실] Send all 버튼은 held가 있거나 보낼 것 3개 이상일 때만 보인다 (CommentsPanel.tsx:131). Waiting 1~2개(예: Resume 후 놓친 것, 미전달 reopen)는 수동으로 보낼 방법이 없다. 개별 코멘트용 Send 동작이 없다(메뉴에도 없음, comment-actions.ts).

### 3.7 상한과 Pause 표시 [중]
- [사실] 상한/Pause 중 새 코멘트와 기존 Waiting은 모두 "Waiting"이고 항목에는 이유가 없다 (comment-state.ts). 이유는 패널 머리 FlowBar에만 있다 (CommentsPanel.tsx:56-66). 핀 색도 Held, Waiting, Unverified가 같은 검정(CommentPin.tsx:11-17).
- [사실] Pause는 `flow.json`에 저장되는 기기 전역 설정이라 (comments.ts:246) 덱이 달라도 적용된다. 패널은 현재 덱의 코멘트만 보이므로 다른 덱 사용량이 상한을 채워도 이 덱에서는 이유가 머리 줄 말고 안 보인다. 사용량은 삭제된 코멘트가 빠지므로 (currentFlow가 존재하는 deliveredAt만 셈, :248-257) 삭제로 상한을 푸는 길이 있다 [의견, 의도일 수 있음].
- [사실] FlowBar의 "Auto-processing on"은 채널이 연결 안 돼도 보인다 (FlowBar는 channel 무관). ChannelBadge와 따로 있어 "Auto-processing on + Claude not connected"가 동시에 뜰 수 있다.
- [사실] 상한 토스트는 한 번만 (comment-flow.ts:17-18).

### 3.8 서명 안 된 코멘트 막다른 길 [중]
- [사실] Unverified는 항목별 Trust 버튼뿐이다. 일괄 Trust가 없다. 남에게 받은 덱에 코멘트 50개, 또는 키 파일 삭제/손상 시 전부 Unverified (comments.ts:58-61 안내) -> 50번 클릭.
- [사실] Trust해도 held였으면 Held로 가고 직접 Send all을 눌러야 한다. 안내 없음.
- [사실] stateOf가 replied를 unverified보다 앞에 둔다. 외부 comments.json이 `status:"done"`과 reply를 들고 오면 서명 없이도 "Replied"로 보이고 reply 글이 "Claude, N min ago"라는 이름 아래 뜬다 (CommentsPanel.tsx:235-239). 신뢰 표시는 reply에는 적용 안 된다 [의견: 위조된 Claude 답이 가능].
- [사실] editBase/editHash도 외부 파일에서 읽힌다 (sanitize :179-180). Revert 버튼이 서명 없이 나타날 수 있다. 서버가 해시 일치를 요구하므로 실사용 위험은 낮다 [확인 필요].
- [사실] 에이전트에게 Unverified는 get_pending의 안내 한 줄뿐 (channel :127). 안내 전달 대상이 사용자인데 reply 도구로는 코멘트별 답만 가능.

### 3.9 영역 이미지 [중~하]
- [사실] pending 상태는 서버 재시작 때 복구되지 않는 것으로 보인다 (capture.ts, server.ts에서 pending 처리 grep 결과 없음). sanitize는 pending을 그대로 읽는다 (comments.ts:189). 캡처 큐는 메모리라 재시작 중이면 "Making a picture..." 영구, Send all은 매번 5초 대기 후 imageState none으로 전달. [확인 필요]
- [사실] restore 후 image는 항상 failed (:451)로 되돌려지고 재캡처 경로가 없다.

### 3.10 지시문 모순 [중]
- [사실] 채널 지시문 0단계는 "작업을 시작하면 먼저 ack" (channel :56)인데 ack 도구 설명은 "수정 없이 거절하거나 질문만 할 때는 생략해도 된다" (:83). 둘 다 reply로 마무리하라고 한다. Working 표시가 일관되지 않게 된다.
- [사실] reply 도구 설명: "질문이나 거절도 done 처리". 이 때문에 3.3의 문제가 규칙으로 고정돼 있다.
- [사실] reply 409를 "처리된 것으로 본다" (:70)고 했는데 Claude가 같은 코멘트를 재시도하는 시나리오(세션 재시작)는 3.1에서처럼 애초에 알림이 다시 안 온다.
- [사실] 묶음 알림 지시문은 "항목마다 ack와 reply" (:61, :43). 순서대로 ack-edit-reply 하면 editsBetween의 시간 창(ack~reply)이 겹쳐 (comments.ts:343) 서로 다른 코멘트가 같은 editBase를 공유한다. 한 코멘트를 Revert하면 다른 코멘트의 수정까지 되돌아가고, 다른 코멘트의 reply 이후 해시가 달라져 "changed" 거절도 난다 (:388). HANDOFF:79도 시간 창 방식임을 인정한다. [확인 필요] 실제 겹침 정도.
- [사실] ack 없이 reply하면 editsBetween의 시작이 deliveredAt, 그것도 없으면 createdAt이다 (:343). createdAt부터면 훨씬 이전의 외부 수정까지 Revert 범위에 들어갈 수 있다.

### 3.11 SSE와 동기화 [중]
- [사실] use-comments-live는 재연결 때 목록을 다시 받지 않는다 (use-comments-live.ts:24-32, onopen/refetch 없음). EventSource가 자동 재접속하는 동안 놓친 reply/ack/delivered 이벤트는 새로고침 전까지 반영되지 않는다. 서버 재시작 후 흔한 상황.
- [사실] 편집기 하나가 SSE를 3~4개 연다 (Editor.tsx:217, use-comments-live.ts:24, comment-flow.ts:22, use-live-update.ts:74). 서버 구독자 상한이 20이다 (comments.ts:533). 탭 여러 개 + 채널이면 503 가능. [확인 필요] 탭당 개수 정확히.
- [사실] 삭제 이벤트는 "comments" 전체 교체이고 다른 이벤트는 upsert다. 낙관적 upsert (Editor.tsx:721)는 trusted를 안 채우고 서버 이벤트가 덮는다. 중복 키 위험은 코드상 없음.

### 3.12 기타 [하]
- [사실] Delete와 Backspace가 포커스된 코멘트(패널 li, 핀)를 확인 없이 지운다 (CommentsPanel.tsx:152, CommentPin.tsx:60). Undo 토스트 8초 (Toaster TOAST.undo)에 의존한다. 토스트는 최대 3개 (Toaster.tsx:16)라 연속 삭제 시 앞 Undo가 밀려난다.
- [사실] "Open" 필터는 held/waiting/sent/working/unverified만 센다 (CommentsPanel.tsx:16). Replied(답을 읽고 해결해야 하는 것)는 Open에 안 들어가 "할 일" 필터가 따로 없다. 필터 Replied/Resolved는 0건이면 버튼이 숨는다 (:178).
- [사실] Add가 만든 상태 이름이 Add(UI) / hold(API) / Held(상태)로 셋이다.

---
## 4. UI 문제

### 4.1 패널 정보 구조
- [사실] 항목 한 줄에 번호, 상태 배지, 시각만 있고 상태 시각(전달됨/ack/답한 시각)은 reply 때만 표시 (:237). Sent 얼마나 오래됐는지 알 수 없어 3.1의 "멈춘 상태"를 알아챌 수 없다. [의견] 상태 경과 시간 표시 필요.
- [사실] 머리 영역에 ChannelBadge, FlowBar, Batch 줄, 필터, 키 안내가 세로로 5단 (:168-185). 코멘트가 적을 때도 머리가 큼. 모바일급 좁은 폭 설계 여부는 [확인 필요].
- [사실] 슬라이드별 그룹은 있지만 요소별/스레드별 묶음, 정렬 선택, 검색이 없다. 300개 규모는 가상화 없이 전체 렌더 (HANDOFF:46 "허용 범위라 두었다").
- [사실] 상태 변경 동선: 상태를 바꾸는 단추는 Resolve/Reopen/Trust뿐. Send, Retry, Cancel, Mark as question이 없다.
- [사실] "Resolve all replied (N)"은 답 내용을 보지 않고 일괄 처리 (3.3).
- [사실] 키 안내 문장이 코멘트 2개 이상일 때만 나온다 (:185). E=해결, Delete=삭제, R(답 보기)은 후속 후보 (HANDOFF:110).

### 4.2 핀과 상태 색
- [사실] 핀 색은 3그룹뿐: 검정(held, waiting, unverified), 파랑(sent, working), 초록(replied), 반투명 검정(resolved). Held와 Waiting, Sent와 Working이 핀에서 구분 안 된다 (CommentPin.tsx:11-26). 이름(aria-label)만 구분한다.
- [사실] resolved 핀은 번호 대신 체크 아이콘이라 (:68) 패널 번호와 연결이 끊긴다. unverified도 아이콘만. 핀 표시 필터(해결된 것 숨기기)가 없다.
- [사실] Working 핀에 애니메이션이 없다. 패널 배지만 spin.
- [사실] recheck, slideDeleted 같은 위험 상태가 핀에 안 보이고 Canvas에서는 요소가 없으면 핀이 숨겨진다.
- [사실] 필름스트립 표시(marked)는 open 코멘트만 센다 (Editor.tsx:964) -> 답이 달린 코멘트(해결 대기)는 표시 안 됨.

### 4.3 작성창
- [사실] Enter=Add(보류), Cmd+Enter=Send now. 보통 채팅 입력에서 Enter가 보내기라는 기대와 반대라 힌트가 항상 있다 (Composer.tsx:82). 단 text가 MAX-200을 넘으면 힌트가 글자 수로 교체된다 (:82).
- [사실] Add 직후 토스트가 없고 패널 탭만 전환 (Editor.tsx:722). "Held"의 의미(보내지 않음)를 처음 쓰는 사람은 알기 어렵다. 채널 미연결 안내는 "Add keeps it on hold"로만 짧게 있다 (:79).
- [사실] 상한/Pause 안내와 채널 미연결 안내는 배타적 (:79). 둘 다일 때는 Pause 문구만 보인다.
- [사실] Cancel/Esc는 입력 글을 확인 없이 버린다.
- [사실] 오류 문구 "Could not send. Your text is kept, try again." (:46)는 서버 사유(키 오류 500의 안내 포함, comments.ts:314)를 숨긴다 -> KeyError의 해결 안내가 사용자에게 안 간다.
- [사실] 전송 전에 현재 덱을 먼저 저장한다 (Editor.tsx:705). 저장 실패하면 아무 알림 없이 return(작성창은 열린 채로 남을 수 있음) [확인 필요].

### 4.4 토스트
- [사실] 공용 Toaster는 단일 role=status aria-live=polite (Toaster.tsx:34). 최대 3개. 전달/답/해결 토스트가 섞이면 undo가 밀릴 수 있다.
- [사실] "Sent N comments to Claude"가 실제 전달을 보장하지 않는다 (3.6). "Claude replied on slide N"은 질문/거절과 완료를 구분하지 않는다. 슬라이드 번호만 있고 코멘트 번호/요약이 없다.
- [사실] 오류는 토스트가 아니라 live.error 문자열로 올라간다 (use-comments-live.ts). 어디에 렌더되는지 이번 감사 범위에서 확인 안 함 [확인 필요].

### 4.5 접근성 (코드와 e2e 기대에서 보이는 것만)
- 좋은 점 [사실]: 상태는 색+아이콘+글자 병기 (CommentsPanel.tsx:22), 핀 aria-label에 번호와 상태 (CommentPin.tsx:42), 모드 층 aria-live 안내(ModeLayer.tsx:182), 작성창 포커스 복귀 (Composer.tsx:31-40), 필터 aria-pressed, FlowBar role=status, axe 검사가 작성창에 있음 (comments-a11y.cjs:148).
- 문제 [사실/의견]:
  - 패널 항목 한 개가 거대한 button(번호, 배지, 영역, 발췌, 본문 전체)이라 스크린리더가 항목마다 긴 이름을 읽는다 (CommentsPanel.tsx:208-231). 의도(WCAG 2.5.3)지만 길다. [의견]
  - 패널의 role=status가 FlowBar와 ChannelBadge 둘이고 상태 변화마다 읽힌다. 채널 재연결이 잦으면 소음 [의견].
  - 핀 hover scale 강조는 시각 전용이고 목록 포커스 시 핀 강조는 data-hover라 스크린리더에는 연결이 없다 [의견].
  - Working 상태 변화(ack)는 live region으로 알리는 코드가 없다. 답 도착은 토스트(polite)로 읽힌다. Sent->Working 전이는 읽히지 않을 수 있다 [확인 필요].
  - 단축키 E, Delete, J/K는 패널 포커스 안에서만. 핀에서 E와 Delete (CommentPin.tsx:57-61)도 확인 없는 파괴 동작.
  - 키보드로 slideDeleted나 recheck 코멘트 확인은 가능하지만 "왜 이동이 안 되는지" 안내가 없다 (Editor.tsx:727 조용히 return).

---
## 5. 가장 심각한 것 (요약용)
1. Sent/Working에서 세션이 끊기면 영구 정지: 재전송, 취소, 타임아웃 없음 (3.1, channel :239).
2. Reply는 1회뿐이고 스레드 없음: 질문 reply도 Replied/done이라 일괄 해결되고 후속은 맥락 없는 새 코멘트 (3.3).
3. "Reopen"은 재요청이 아님(done 유지, reply 409) + 재요청 경로 없음 (3.2).
4. 슬라이드 번호가 Claude 편집, 복원으로 바뀌면 remap 안 됨, slideDeleted는 영구, backfill은 slideDeleted를 안 거름 (3.5).
5. Send all 토스트가 Pause, 상한, 채널 미연결에서도 "Sent"라고 거짓 성공 표시 (3.6).
6. flagAfterRestore가 인라인 태그/엔티티 때문에 오탐, open만 검사, 해제 수단 없음 (3.5).
7. 핀/상태 구분 약함(Held=Waiting, Sent=Working 같은 색), Waiting의 이유가 항목에 없음, SSE 재연결 후 재동기화 없음 (3.7, 3.11, 4.2).
