# 코멘트 UI 벤치마킹과 개선 설계 (editor-dev, 설계만, 구현은 사용자 결정 뒤)

channel-dev의 `spec/COMMENT-UX.md`(생명주기, 데이터, 동작)에 합쳐지도록 **UI 쪽**만 쓴다. UI 문구는 영어, 설명은 한국어. 조사 출처는 6절. 브라우저는 새로 돌리지 않았고 현재 화면 진단은 코드와 기존 e2e 산출물(`/tmp/slidekit-ux-shots/1440`, `390`)로 했다.

## 0. 요약

- 지금 코멘트는 **"요소를 골라 쓰고 목록에서 상태를 본다"**까지만 된다. Figma가 주는 핵심(핀을 누르면 그 자리에서 열리는 **스레드**, 호버 미리보기, 읽지 않음, 클러스터, 핀 드래그, 키보드 R/E/J/K)이 없고, 모든 상호작용이 오른쪽 패널로 쏠린다.
- 가장 큰 문제 셋: ① 핀을 눌러도 캔버스에 아무것도 안 열린다(패널로 점프) ② 상태가 7개(Held, Waiting, Sent, Working, Replied, Resolved, Unverified)라 "내 코멘트가 지금 어디까지 갔는가"가 한눈에 안 읽힌다 ③ 한 코멘트에 답이 하나뿐이라 대화가 못 이어진다(후속은 새 코멘트).
- 개선안(한 줄): **핀 → 호버 미리보기 → 클릭하면 스레드 팝오버(답글, 해결, 되돌리기)**, 패널은 **슬라이드 필터, 정렬, 읽지 않음, 대기열 트레이(Send all)**로 재구성, 상태는 **진행 점 4단계**로 단순화, 좁은 화면은 **바텀 시트**.
- 새 의존성 없음. 구현 크기는 핀/스레드 팝오버(중), 패널 재구성(중), 상태 단순화(작음), 데이터(스레드 배열, 읽음)는 channel-dev 소관.

## 1. 벤치마킹: 우리가 따라갈 것

| 항목 | Figma | Google Docs | Claude Science(Artifacts) | 우리 현재 | 목표 |
|---|---|---|---|---|---|
| 진입 | 툴바 아이콘 또는 `C`, 모드에서 클릭 또는 드래그, Esc로 나옴 | 선택 후 Add comment | 선택 후 `Comment`(HTML은 `Comment` 토글 후 요소 클릭) | C, Shift+C, 툴바 토글, 영역 드래그(있음) | 유지 |
| 핀 | 위치에 핀, 호버 미리보기, **클릭하면 캔버스에서 스레드 모달**, 멀리서 보면 **클러스터**(개수와 아바타) | 오른쪽 여백의 카드, 본문 하이라이트 | 본문 하이라이트 배지, 이미지는 번호 핀, 호버로 읽고 클릭으로 Edit/Delete | 번호 핀만, 클릭하면 패널로 점프, 겹치면 가로로 늘어놓음 | 호버 미리보기, 클릭=스레드 팝오버, 클러스터 |
| 스레드 | 답글(이모지, 멘션), Enter로 전송 | 답글, Resolve, Re-open | **스레드와 해결 없음**(보낸 뒤 카드로 사라짐) | 답은 1개, 후속은 새 코멘트 | 스레드(사용자 ↔ Claude 번갈아), Resolve/Reopen |
| 해결 | 오른쪽 위 체크, 캔버스와 패널에서 숨김, `Show resolved comments`로 다시 보기 | Resolve, Re-open, 완료 | 없음 | Resolve 단추 + 흐리게(숨기지 않음) | 해결하면 핀 숨김(필터로 보기) |
| 목록 | 오른쪽 사이드바: 검색, **Sort by date / unread**, **Only your threads**, **Show resolved**, 현재 페이지 필터 | Show all comments, All/Open/Resolved, 키워드 검색 | 메시지 입력창 위에 **대기 중 코멘트 트레이**(보낼 때 함께 전송) | All/Open/Replied/Resolved 필터와 개수, 슬라이드별 묶음, 정렬·검색 없음 | 필터 + 정렬 + 읽지 않음 + 이 슬라이드만 + 검색 |
| 읽지 않음 | 정렬 기준, "Mark as unread" | 알림 | 없음 | 없음(토스트 한 번뿐) | 핀과 목록에 읽지 않음 점, Claude 답이 오면 켜짐 |
| 키보드 | `C`, `Shift+C`(코멘트 표시 토글), Esc, Enter | R 답글, J/K 이동, E 해결, U 나가기 | Enter 저장, Shift+Enter 줄바꿈 | J/K/E/Delete(패널), Enter/Cmd+Enter(작성창) | + R(답글), U 또는 Esc(스레드 닫기), Shift+C(코멘트 표시 토글) |
| 이동 | 코멘트를 끌어 옮김 | - | - | 없음 | 핀 드래그로 앵커 옮기기(후순위) |
| 보내기 모델 | 즉시 전송 | 즉시 | **저장은 보내지 않음, 다음 메시지와 함께 전송**, 묶음 전송 | Add(보류) / Send now | 대기열 트레이 + `Send` (아래 4절) |

우리만의 강점(유지): 영역 코멘트와 이미지, Claude의 수정 되돌리기(Revert Claude's edit), 자동 처리 일시정지와 시간당 상한 표시, 신뢰되지 않은 코멘트 구분, 키보드 영역 지정.

## 2. 현재 UI 진단 (코드와 산출물 근거)

심각도: P0 사용자가 막히거나 오해, P1 효율과 이해를 크게 해침, P2 다듬기.

| # | 영역 | 문제 | 근거 | 심각도 |
|---|---|---|---|---|
| 1 | 핀 | 핀 클릭이 **패널로 점프**(`onMarker`: Comments 탭으로 전환 + 스크롤). 캔버스에서 답을 읽거나 해결할 수 없어 시선과 맥락이 끊김 | `Editor.tsx onMarker`, `CommentPin.tsx` | P0 |
| 2 | 핀 | 같은 요소의 핀 여러 개가 **가로로 늘어서고**(`data-off`), 번호만 있어 어느 것이 무엇인지 모름. 요소가 작으면 서로 가림 | `04-pins-1440.png`(1~4와 체크와 방패가 한 줄) | P1 |
| 3 | 핀 | 상태가 색과 작은 글자 한 칸(번호 또는 체크)이라 구분이 약함. 색 의존을 줄이려 아이콘을 쓰나 번호 자리를 바꿔 번호가 사라짐(해결, 미검증) | `CommentPin FILL/OUTLINE` | P1 |
| 4 | 핀 | 호버 미리보기 없음. 내용을 보려면 패널을 열어야 함 | - | P1 |
| 5 | 스레드 | 코멘트당 **답 1개**. Claude가 되물어도 이어 말할 곳이 없고 새 코멘트를 써야 함(대화가 쪼개짐) | `Comment.reply` 단일 필드 | P0 |
| 6 | 상태 | **7개 상태 이름**(Held, Waiting, Sent to Claude, Claude is working, Replied, Resolved, Unverified). "Held"와 "Waiting"의 차이, "Sent"와 "working"의 차이가 사용자에게 의미 없음. 지금 어디서 막혔는지(연결 안 됨? 한도? 일시정지?)가 목록 상단 별도 줄에 흩어져 있음 | `comment-state.ts`, `FlowBar`, `ChannelBadge` | P0 |
| 7 | 패널 | 목록이 **전부 슬라이드별 묶음 + 긴 카드**(코멘트 5개로 화면이 참). 개수가 늘면 스캔이 어려움(빽빽하지만 정보는 중복: 번호, 상태, 시간, `on "..."`, 본문, 답, 버튼). 정렬, 검색, "이 슬라이드만" 없음 | `01-panel-states-1440.png` | P1 |
| 8 | 패널 | 상단이 **세 겹**(탭, 연결 상태 + How to connect, 필터, 사용법 한 줄 + 자동 처리 줄): 본문이 시작되기 전에 5줄. 사용법 문구(`J and K move...`)가 항상 떠 있어 노이즈 | `01-panel-states` | P1 |
| 9 | 패널 | 카드마다 `Resolve` 단추가 눈에 띄고 해결 전 흐름(읽음 확인)이 없음. Claude 답을 읽지 않고 해결 가능, 읽지 않음 표시 없음 | `CommentsPanel` | P1 |
| 10 | 작성창 | `Add`(기본)와 `Send now` **두 단추의 차이가 설명이 아니라 암기**(Enter = Add, Cmd+Enter = Send now). 연결돼 있을 때 대부분 사용자는 곧바로 보내고 싶은데 기본이 "등록만"이라 Held가 쌓임. 아래 문구가 단축키 설명으로 채워짐 | `CommentComposer`, `COMMENT-MODE.md` | P0 |
| 11 | 작성창 | 빠른 문구(`Make this shorter` 등)는 좋으나 영문 고정, 사용 빈도 학습 없음(P2). 영역 코멘트의 이미지가 저장 뒤에 만들어져 작성 중에는 **점선 자리표시자**만 보임 | `QUICK`, `area-placeholder` | P2 |
| 12 | 토스트 | 답이 오면 토스트 `Claude replied on slide N` + `View`. 놓치면 끝(읽지 않음 상태가 없음). 다른 슬라이드면 선택 이동이 이어짐 | `ReplyToasts` | P1 |
| 13 | 필터 | `All/Open/Replied/Resolved`에서 **Open이 Held, Waiting, Sent, Working, Unverified**를 뭉침. Replied와 Resolved는 0건이면 사라져 필터 줄이 바뀜(레이아웃 점프) | `FILTERS`, `.filter(...counts)` | P2 |
| 14 | 빈 상태 | 문구가 정확하나 수동적: `Select an element and press C`. 코멘트 모드(Shift+C)와 영역 드래그를 가르치지 않음 | `CommentsPanel` | P2 |
| 15 | 접근성 | 좋은 점: 상태 아이콘+글자, 버튼 이름이 보이는 글자, J/K/E. 부족: **핀이 캔버스 오버레이 안의 개별 버튼**이라 탭 순서가 요소와 따로 놀고 개수가 많으면 탭 정지 과다(roving 필요), 스레드가 없어 스크린 리더 대화 구조 없음, 색 대비는 상태별 확인 필요(`text-emerald-400` on 어두운 배경은 통과, `muted` 상태는 약함) | `CommentPin`, `CommentsPanel` | P1 |
| 16 | 좁은 폭 | 390px에서도 패널이 **전체 폭 오버레이**로 열려 캔버스를 가리고(`01-panel-states-390.png`), 필터 줄이 두 줄로 접힘. 핀은 터치 타깃 20px로 작음(권장 24px 이상) | `390/01-panel-states` | P1 |
| 17 | 모드 | 코멘트 모드(Shift+C, 영역 드래그, 키보드 영역)는 강력하지만 **발견성이 없음**: 툴바 아이콘 하나, 알약 문구는 모드에 들어온 뒤에야 보임, 패널 빈 상태가 안 가르침 | `COMMENT-MODE.md` | P1 |
| 18 | 연결 | `Claude not connected`가 헤더와 패널에 두 번, `How to connect`는 접힌 details라 명령을 복사하려면 두 번 클릭 | `ChannelBadge`, `NotConnected` | P2 |
| 19 | 라벨 | `Resolve all replied (n)`, `Send all to Claude (n)`처럼 **일괄 단추가 조건부로 나타나 위치가 흔들림**, 의미가 설명 없이 짧음 | `CommentsPanel showSend/showResolve` | P2 |

## 3. 설계 원칙

1. **캔버스에서 끝낸다**: 쓰기(있음), 읽기, 답하기, 해결을 모두 캔버스의 핀과 스레드 팝오버에서 할 수 있다. 패널은 "전체 훑기와 일괄 처리"용이다.
2. **한눈에 "어디까지 갔나"**: 진행 점 4개(Saved ● Sent ● Working ● Replied)와 한 줄 상태 문구. 막힘(연결 안 됨, 일시정지, 한도)은 그 코멘트 옆에서 이유와 풀 방법을 말한다.
3. **대화는 한 스레드**: 사용자 ↔ Claude 메시지가 한 코멘트 아래 이어진다(데이터는 channel-dev).
4. **읽지 않음이 Claude 답의 알림**: 토스트는 보조, 기준은 핀과 목록의 점.
5. **지금 흐름을 깨지 않는다**: C, Shift+C, 영역, Enter/Cmd+Enter, 우클릭 메뉴, Revert, Trust 모두 유지(사용자가 익힌 것).
6. 새 의존성 없음, 오버레이는 `pointer-events` 최소, 핀 수백 개에서도 가볍게(속성만 갱신하는 현재 방식 유지).

## 4. 핀, 호버, 스레드 팝오버

### 4.1 핀 모양과 상태

- 모양: 둥근 말풍선(꼬리 있음, 아래 오른쪽) 24px, 번호 안. 꼬리 끝이 앵커 좌표(요소 오른쪽 위 모서리 또는 영역 오른쪽 위)에 닿는다. 번호는 **항상 보인다**(해결도 번호 유지, 체크는 모서리 배지).
- 상태(색 + 모양 + 글자 보조):

| 상태 | 핀 | 비고 |
|---|---|---|
| Saved(보류) | 속이 빈 윤곽 + 번호 | "Saved, not sent" |
| Sent / Working | 채움(강조색) + 번호, Working은 가장자리 호흡 | 진행 점 3~4번째 |
| Replied(안 읽음) | 초록 채움 + 번호 + **우상단 점** | 클릭하면 점이 사라짐 |
| Replied(읽음) | 초록 윤곽 + 번호 | |
| Resolved | 기본은 **숨김**(`Show resolved`로 흐린 핀 + 체크 배지) | Figma와 같음 |
| Unverified | 방패 배지, 점선 윤곽 | |
| 영역 코멘트 | 핀과 함께 **점선 사각형 윤곽**(호버 때) | 있음 |

### 4.2 겹침과 클러스터

- 같은 요소의 핀은 가로로 늘어놓지 않고 **한 핀 + 개수 배지**(`3`)로 합친다. 호버하면 부채꼴로 풀리고 클릭하면 스레드 목록이 팝오버 안에서 세로로 뜬다(개수가 1이 아니면 팝오버 맨 위에 `1 of 3` 이동 단추).
- 슬라이드를 멀리 줌아웃하면 겹치는 핀 전체를 `+N` 클러스터로 합친다(Figma와 같은 규칙).
- 핀은 요소가 못 찾아지면(`recheck`) 슬라이드 중앙 오른쪽 위에 `?` 배지로 모이고 팝오버에 "Position needs a check"가 있다.

### 4.3 호버 미리보기(150ms 지연)

```
   ┌──────────────────────────────────┐
   │ 3 · Claude is working · 2 min ago│
   │ Make this shorter                │   ← 본문 2줄 줄임
   │ ↳ Claude: Shortened the title.   │   ← 답이 있으면 한 줄
   └──────────────────────────────────┘
```

### 4.4 스레드 팝오버(핀 클릭, Figma의 코멘트 모달)

- 핀 옆에 앵커된 팝오버(화면 밖이면 자동 뒤집기), 폭 320px. 핀을 다시 누르거나 Esc/U로 닫는다. 선택과 모드를 바꾸지 않는다.
- 구성: 머리줄(번호, 진행 점, 시간, `⋯` 메뉴: Resolve, Copy link, Delete, Revert Claude's edit, Mark as unread), 인용(`on "..."` 또는 영역 썸네일), **메시지 목록**(내 글, Claude 답이 번갈아), 답글 입력(`Reply to Claude`, Enter로 전송, 연결 안 됨이면 `Save reply`), 아래에 `Resolve` 단추.
- Claude가 수정했으면 메시지 아래에 `Changed slide 3 · Revert` 한 줄과 변경 강조 보기(`Show change`: 캔버스에서 바뀐 요소를 1.2초 번쩍, 존재 효과와 같은 기능 재사용).

```
 캔버스                                      ┌────────────────────────────── 3 ──┐
  ┌──────────────┐ ●3                       │ ●──●──◐──○  Working · 2 min ago ⋯ │
  │ Title        │◀── 핀                     │ on "Quarterly results"            │
  └──────────────┘                          │───────────────────────────────────│
                                            │ You   Make this shorter           │
                                            │ ✦ Claude  Shortened the title.    │
                                            │          Changed slide 3 · Revert │
                                            │───────────────────────────────────│
                                            │ Reply to Claude…            [Send]│
                                            │                      [✓ Resolve]  │
                                            └───────────────────────────────────┘
```

### 4.5 핀 드래그, 핀 켜고 끄기

- 핀을 끌어 앵커를 다른 요소로 옮긴다(후순위, 데이터 `path` 갱신 필요).
- Shift+C는 **코멘트 모드 토글**이 아니라 Figma처럼 **코멘트 표시 토글**로 둘지는 결정 항목(현재 Shift+C = 모드). 대안: `Shift+Alt+C`가 표시 토글.

## 5. 작성창과 보내기 모델

### 5.1 문제와 제안

지금: Enter = Add(등록만, Held), Cmd+Enter = Send now. Artifacts는 "저장은 보내지 않고 다음 메시지와 함께 전송(묶음)", Figma/Docs는 즉시 전송.

**제안 A(추천)**: 연결 상태에 따라 기본을 바꾼다. 연결됨이면 **Enter = Send to Claude**, 연결 안 됨이면 **Enter = Save**(나중에 연결되면 자동 전송). `Send later`(Add) 단추를 보조로 두어 묶음 작성이 가능하다(Shift+Enter는 줄바꿈 그대로). 이유: Held가 쌓여 "왜 아무 일도 없지"가 되는 것을 줄이고 Figma/Docs 습관과 맞는다. 사용자가 이미 정한 `Add / Send now` 문구와 단축키는 **설정(Preferences)에서 되돌릴 수 있게** 한다.

**제안 B(현행 유지)**: 문구만 개선: `Save` / `Send now`, 단축키 설명은 툴팁으로 내리고 아래에는 연결 상태 한 줄만. 결정은 사용자(질문 카드).

### 5.2 작성창 구성

```
 ┌ Comment on "Quarterly results" ─────────────┐
 │ [영역이면 160×90 썸네일(캔버스에서 바로 자름)] │
 │ Tell Claude what to change…                  │
 │ ○ Make this shorter ○ Simplify ○ Match other │  ← 비어 있을 때만 빠른 문구(최근 사용 우선)
 │ ● Connected · Enter sends        [Save] [Send]│
 └──────────────────────────────────────────────┘
```

- 한글 입력 조합 중 Enter는 확정만(있음). 2000자 상한과 카운터(있음).
- 영역 코멘트의 썸네일은 현재 서버가 저장 뒤 만들어 **작성 중에는 점선 자리표시자**다. 개선: 캔버스 iframe에서 클라이언트가 바로 자르는 미리보기(`Canvas`의 `drawImage` 방식은 이미지 요소에는 가능하나 iframe 안 DOM은 불가) → 현실적으로는 자리표시자를 유지하되 `Making a picture…`를 저장 뒤 스레드 팝오버에서 보이게 한다(P2).

### 5.3 대기열 트레이(Artifacts의 "입력창 위 대기 중 코멘트")

- 보내지 않은(Saved) 코멘트가 있으면 캔버스 아래 또는 패널 아래에 **트레이** `3 saved · Send all` (한 줄, 고정 위치). 일괄 단추가 조건부로 흔들리는 문제(진단 19)를 없앤다. 트레이를 누르면 목록이 펼쳐져 개별로 `Send`/`Remove`.

## 6. 패널 재구성

### 6.1 정보 구조

위에서 아래:
1. **머리줄 한 줄**: `Comments 5` 제목, 연결 점(`●`)과 상태 툴팁 하나(`Claude connected` / `Not connected · How to connect`), `⋯`(Pause auto-processing, Show resolved, Sort). 지금의 3~5줄 머리를 1줄로.
2. **필터 줄**(고정 폭, 점프 없음): `All 7 · Open 5 · Unread 1 · Resolved 1` 칩 4개, 오른쪽에 `This slide` 토글과 검색 아이콘.
3. **목록**: 기본 정렬 = 최신 활동순(Figma는 날짜/읽지 않음) 또는 슬라이드순, `Sort` 메뉴에서 전환. 슬라이드 묶음은 **접을 수 있는 구역**.
4. **하단 고정 트레이**: `3 saved · Send all`(5.3).

### 6.2 카드(컴팩트, 한 줄 요약 + 펼치기)

```
 ┌───────────────────────────────────────────────────┐
 │ ③ ●●◐○ Working            Slide 3 · 2 min ago  ⋯ │   ← 번호, 진행 점, 상태, 위치와 시간, 메뉴
 │ Make this shorter                                  │   ← 본문(최대 2줄)
 │ ✦ Claude: Shortened the title.          ● unread   │   ← 마지막 답 미리보기(있을 때), 읽지 않음 점
 └───────────────────────────────────────────────────┘
   클릭 = 캔버스 핀으로 이동 + 스레드 팝오버 열기, 카드 안의 화살표 = 카드 안에서 펼침(스레드 전체)
```

- 단추는 평소에 숨기고(호버, 포커스 때만) `Resolve`(체크 아이콘), 나머지는 `⋯` 메뉴(기존 우클릭 메뉴와 같은 항목). 해결된 카드는 흐리게가 아니라 **`Resolved` 구역으로 모음**.
- `on "..."` 인용은 호버 툴팁으로 내리거나 카드 펼침에서만(밀도).

### 6.3 빈 상태와 안내

```
        💬  No comments yet
   Click an element and press C, or press Shift+C to
   comment anywhere. Drag to comment on an area.
              [ Start commenting ]
```

- 사용법 한 줄(`J and K ...`)은 **패널이 포커스일 때만** 나타나는 힌트 줄(`?`로 전체 단축키)로 옮긴다. `Start commenting` 단추가 코멘트 모드를 켠다(발견성, 진단 17).

## 7. 상태와 생명주기 표시(UI만, 정의는 channel-dev)

사용자에게 보이는 이름을 **5개**로 줄인다.

| 보이는 이름 | 내부 상태 | 진행 점 | 의미 한 줄 |
|---|---|---|---|
| Saved | held, waiting(연결 안 됨 또는 한도) | ●○○○ | `Saved. Sends when Claude connects.` / `Waiting for the hourly limit (resumes 14:05)` |
| Sent | sent | ●●○○ | `Sent to Claude.` |
| Working | working | ●●◐○ | `Claude is working on it.` |
| Replied | replied | ●●●● | `Claude replied.` + 읽지 않음 점 |
| Resolved | resolved | - | 구역으로 이동, 핀 숨김 |
| (보조) Unverified | unverified | - | 별도 배지(방패) |

- 막힘은 상태 이름이 아니라 **이유 한 줄**로 말한다: `Saved · Claude is not connected` / `Saved · Paused (Resume)` / `Saved · Limit reached, resumes at 14:05`. 이유 옆에 해결 단추(`Connect`, `Resume`)를 둔다. 헤더의 `FlowBar`와 `ChannelBadge`는 이 이유로 흡수된다.
- 진행 점은 색이 아니라 **채움 개수**로 읽히고 `aria-label`로 `Step 3 of 4: Claude is working`을 준다.

## 8. 알림과 읽지 않음

- Claude 답이 오면: ① 핀에 점 ② 패널 탭의 개수 옆 점 ③ 토스트(`Claude replied on slide 3 · View`, 한 번) ④ 현재 슬라이드가 아니면 **필름스트립 타일에 점**(존재 효과의 타일 표시 재사용).
- 읽음 처리: 스레드 팝오버를 열거나 패널 카드를 펼치면 읽음(`Mark as unread`로 되돌림). 읽음 상태는 서버에 두면 기기 간 공유, 로컬이면 이 기기만(channel-dev 결정).

## 9. 좁은 폭(모바일, 태블릿)

- 핀 24px(터치 타깃 보강: 투명 패딩으로 44px), 팝오버는 **바텀 시트**(아래에서 올라오는 시트, 캔버스를 가리지 않게 핀이 보이는 높이까지만, 끌어 닫기).
- 패널은 전체 폭 오버레이 대신 **시트 두 단계**(목록 시트 ↔ 스레드 시트).
- 작성창은 키보드가 올라오면 시트 안에서 입력창 + 한 단추(`Send`)만(Save는 `⋯`).

## 10. 키보드와 접근성

| 키 | 동작 |
|---|---|
| `C` / `Shift+C` | 현재와 같다(요소 선택 시 작성창, 모드 토글) |
| `N` / `P` (캔버스 포커스) | 다음, 이전 핀으로 이동(핀 roving tabindex 한 정지) |
| `Enter` (핀 포커스) | 스레드 팝오버 열기 |
| `R` (팝오버) | 답글 입력으로 이동 |
| `E` | 해결/다시 열기(현재 유지) |
| `U` 또는 `Esc` | 팝오버 닫기, 포커스는 핀으로 |
| `J` / `K` (패널) | 현재 유지 |

- 팝오버는 `role="dialog"` 비모달(`aria-labelledby` = 머리줄), 메시지 목록은 `role="list"`, 읽지 않음은 `aria-label`로 `Unread reply`. 상태 변화는 `aria-live=polite` 한 곳에서 읽는다(Claude 답, 해결).
- 핀 수가 많아도 탭 정지 하나(roving), 번호와 상태가 이름에 들어간다.
- 움직임 줄이기: Working 호흡과 클러스터 부채꼴 전환 없음.

## 11. 성능과 안정성

- 핀 위치는 지금처럼 요소 좌표를 이벤트와 줌 변화 때만 읽어 `transform`으로 놓는다(수백 개에서 호버 시 재렌더 없음: 속성만 바꾸는 현재 방식 유지).
- 호버 미리보기와 팝오버는 한 번에 하나, 클러스터 계산은 슬라이드당 한 번(O(n log n)).
- 스레드 팝오버는 열 때만 마운트(지연), 패널 목록은 `content-visibility:auto` 구역.

## 12. 단계적 구현 제안(사용자 결정 뒤)

| 단계 | 내용 | 규모 | 의존 |
|---|---|---|---|
| 1 | 상태 5개 이름과 진행 점, 막힘 이유 한 줄, 필터 줄 고정, 머리줄 1줄, 빈 상태 CTA, 사용법 힌트 포커스 때만 | 작음 | 없음(UI) |
| 2 | 핀 모양(말풍선, 번호 유지, 해결 숨김), 호버 미리보기, 클러스터/개수 배지 | 중 | 없음 |
| 3 | 스레드 팝오버(읽기, 해결, 메뉴, Revert), 패널 카드 컴팩트화와 펼치기, 트레이 | 중 | 스레드 데이터(여러 메시지) 있으면 답글 |
| 4 | 읽지 않음(핀 점, 탭 점, 타일 점), 정렬, 이 슬라이드만, 검색 | 작음~중 | 읽음 필드 |
| 5 | 작성창 보내기 모델(제안 A), 설정 | 작음 | 사용자 결정 |
| 6 | 바텀 시트, 핀 터치 타깃, 핀 드래그 | 중 | - |

## 13. 사용자에게 물을 결정(질문 카드 후보)

1. 보내기 기본: 제안 A(연결되면 Enter = 바로 보내기, Save는 보조) vs B(현재 Add/Send now 유지).
2. 해결한 코멘트의 핀: 숨김(Figma, 추천) vs 흐리게 남김(현재).
3. 스레드 팝오버(캔버스에서 읽고 답하고 해결)와 패널의 역할 분담: 팝오버가 기본(추천) vs 지금처럼 패널이 기본.
4. 상태 이름 5개로 단순화(Saved, Sent, Working, Replied, Resolved) 동의 여부와 문구.
5. 읽지 않음을 서버에 저장(기기 간 공유)할지, 이 기기만 할지.
6. Shift+C를 모드 토글로 유지(현재)할지, Figma식 "코멘트 표시 토글"로 바꾸고 모드는 다른 키로 할지.
7. 핀 드래그로 앵커 이동을 이번에 넣을지(후순위 추천).

## 14. 출처 (확인일 2026-10-18)

- Figma 코멘트: https://help.figma.com/hc/en-us/articles/360041547593 (코멘트 모드 `C`, Shift+C 숨기기/보이기, 핀 호버 미리보기와 클릭 모달, 줌아웃 시 클러스터, Sort by date/unread, Only your threads, Show resolved comments, Resolve와 Show resolved로 복원, Mark as unread, Copy link, Delete, Reply와 이모지와 멘션, Enter로 전송). 보조: https://help.figma.com/hc/en-us/articles/360039824594 , 포럼(정렬 기준과 읽지 않음 한계) https://forum.figma.com/suggest-a-feature-11/save-comment-sort-order-preference-19901
- Figma Slides 코멘트: https://help.figma.com/hc/en-us/articles/24346990418199-Work-on-slide-decks-together (덱 전체의 피드백, 질문, 메모에 쓰고 **발표자 노트에는 못 단다**), 포럼 https://forum.figma.com/suggest-a-feature-11/ (노트 코멘트 요청)
- Claude Science 아티팩트 코멘트: https://claude.com/docs/claude-science/comments (선택 후 `Comment`, Enter로 저장/Shift+Enter 줄바꿈, 텍스트는 하이라이트 배지와 이미지는 번호 핀, 호버로 읽고 클릭으로 Edit/Delete, **저장은 보내지 않고 입력창 위 대기 코멘트로 다음 메시지와 함께 전송**, 이미지에서 `Ask`로 사이드 챗, **스레드와 해결 없음**, 1000자)
- Google Docs: https://support.google.com/docs/answer/65129 (Add comment, Reply, Resolve, Re-open, 완료(Done), 이모지 반응, `Show all comments`, All/Open/Resolved와 "Comments for you" 필터와 키워드 검색, 코멘트 선택 시 R 답글 J/K 이동 E 해결 U 나가기)
- 우리 현재 UI: `app/src/CommentsPanel.tsx`, `CommentPin.tsx`, `CommentComposer.tsx`, `ReplyToasts.tsx`, `lib/comment-state.ts`, `lib/comment-flow.ts`, `spec/COMMENT-MODE.md`, 산출물 `/tmp/slidekit-ux-shots/1440/01-panel-states-1440.png`, `04-pins-1440.png`, `390/01-panel-states-390.png`.
