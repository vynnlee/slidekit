# Animation 타임라인 편집 UI 설계 (개정 2: 결정 반영본, 구현됨: 현재 규칙은 SPEC 9.7)

상태: 승인되어 구현됨(SPEC 9.7이 현재 규칙, 이 문서는 설계 근거). 구현 중 바뀐 점: 용어는 조사 결과를 따랐고, 탭 열기 예산은 편집기 재렌더 기준선을 분리해 따로 쟀다. UI 문구는 영어, 설명은 한국어. 저장 모델은 **A+**, 규격은 engine-dev의 `spec/ANIMATION.md`(커밋 608fb4c: 2.4 변수와 되감기, 2.6 시작 방식, 3.7 압축, 3.8 값, 3.9 타임라인 필드)를 기준으로 맞췄다. 개정 1은 `DESIGN.v1.md`에 남겼다. **사용자 승인 필요 목록은 없다**(12절은 확정된 결정과 남은 구현 순서).

## 0. 한 장 요약

- 하단 Animation 탭 = **클릭 구역(Click 1, Click 2 ...)을 세로로 쌓고, 각 구역 안에 시간 눈금(0~T초)과 요소별 트랙**. 트랙 하나 = 애니메이션 하나(In 또는 Out). 막대의 **왼쪽 위치 = Delay(클릭 후 기다리는 시간)**, **길이 = Duration**.
- "With previous / After previous"는 **저장하지 않는다**(숫자가 진실). 막대를 같은 시작에 놓거나 앞 막대 끝에 붙이면 자석 스냅과 칩이 그 관계를 알려 주고, 인스펙터의 단추 둘은 숫자를 채우는 편의 동작일 뿐이다.
- 트랙 줄 순서는 표시용(시작 시간순, 자동)이다. 재생은 시간으로만 정해지므로 현재 목록의 "줄 순서가 의미", "선택 줄 아래에 With가 딸려감", "순서 이동" 문제가 구조적으로 사라진다.
- **스크럽은 전환 프레임까지 정확**: 엔진 CSS가 만든 실제 `CSSTransition`을 `pause()`하고 `currentTime = t`로 맞춘다(스파이크로 Chromium과 WebKit 모두 확인, 3절).
- 숫자 입력은 인스펙터에만(선택한 막대의 Delay, Duration, Click).
- 용어는 PowerPoint, Keynote, Google Slides, Figma Slides, Canva, reveal.js, Slidev를 조사해 가장 통상적인 조합으로 정했다(6절).

## 1. 타임라인 구조

### 1.1 레이아웃

1. **도구줄**: `Play`(슬라이드 전체), `Click ◂ 2/3 ▸`, 현재 시간 `0.35s`, 오른쪽에 `Zoom − / + / Fit`, `?`(How timing works), `Add animation`.
2. **본문**: 왼쪽 고정 열(요소 이름, 140px)과 오른쪽 시간 영역(가로 스크롤). 구역(Click n)이 세로로 쌓인다. 구역마다 머리줄(접기 화살표, `Click 2`, 구역 길이 `0.0–0.8s`, `▶` 이 구역만 재생), **눈금자**, 트랙들.
3. 모든 구역이 **같은 시간 눈금**을 쓴다(구역을 오가며 막대를 끌어도 Delay가 비교됨). 눈금 끝(T)은 가장 긴 막대 끝 + 여유(최소 1.5초, 최대 10초).

### 1.2 트랙과 막대

- 트랙 하나 = (요소, In 또는 Out). 왼쪽 라벨: 아이콘(In ◗▸, Out ▸◖) + 요소 이름. 같은 요소의 In과 Out은 서로 다른 구역에 있다(Out은 항상 자기 In보다 뒤의 구역, 순위 비교).
- 색과 모양으로 구분: In = 강조색 채움, Out = 따뜻한 색 + 오른쪽이 비스듬히 잘린 모양. 막대 안 글자는 폭이 넓을 때 효과 이름(`Fade`), 좁으면 생략하고 툴팁.
- 막대 최소 폭 6px(스케일 하한). 구역의 시간 0에 세로 점선 `Click`.
- 트랙 순서: 구역 안에서 (Delay, 문서 순서, In 먼저)로 자동. 수동 순서 조작은 없다.
- 막대가 없는 구역은 없다(빈 단계는 엔진이 압축해 클릭으로 세지 않음).

### 1.3 조작(끌기)

| 대상 | 조작 | 저장되는 값 |
|---|---|---|
| 막대 몸통 | 좌우로 끌기 | Delay = 위치(0 아래로는 못 감) |
| 막대 오른쪽 끝 | 좌우로 끌기 | Duration |
| 막대 왼쪽 끝 | 좌우로 끌기 | Delay와 Duration을 같이(오른쪽 끝은 고정) |
| 막대 몸통 | 다른 구역으로 위아래 끌기 | Click(단계) 이동, Delay는 그대로 |
| 구역 사이 또는 맨 아래 `New click` 영역에 놓기 | 위아래 끌기 | 새 클릭 구역을 만들고 거기로 이동 |
| 눈금자 | 클릭, 끌기 | 재생 헤드 이동(3절) |
| 빈 시간 영역(요소 선택 중) | 더블클릭 | 그 시각을 Delay로 둔 In 추가 |

- **스냅**: 기본 0.05초(정수 50ms). 막대의 시작과 끝은 **자석 스냅**(다른 막대의 시작, 끝, 0에 6px 이내). 스냅되면 세로 안내선과 칩: `With previous · Title`(같은 시작), `After previous · Title`(앞 막대 끝에 붙음). Alt를 누르면 스냅 없이 0.01초 단위(저장은 정수 ms).
- 끌기 중에는 막대 `transform/width`와 안내선만 DOM에서 직접 바꾼다(React 상태 없음, rAF로 합침). 놓을 때 **한 번 저장 = 실행 취소 한 건**.
- 금지된 놓기: Out을 자기 In과 같거나 앞선 구역으로 옮기면 그 구역이 빗금으로 막히고 칩 `Out must come after In`이 뜨며, 놓으면 제자리로 돌아온다(이유를 숨기지 않음).
- 다중 선택(Shift+클릭): 같은 변화량으로 같이 이동(구역 이동은 단일 선택만).

### 1.4 인스펙터(숫자 입력)

막대 선택 시 인스펙터 Animation 섹션이 그 막대를 편집(요소만 선택했을 때는 그 요소의 In, Out 두 블록):

- `Effect`(Fade, Rise, Slide, Scale, Blur 셀렉트), `Delay` 초 입력(스테퍼 ±0.05), `Duration` 초 입력, `Click` 셀렉트(`Click 1 … Click n, New click`), 삭제.
- 편의 단추 둘: `With previous`(위 트랙의 Delay를 복사), `After previous`(위 트랙의 Delay + Duration). 한 번 누르면 숫자만 채우고 관계는 저장되지 않는다. "위 트랙" = 같은 구역의 바로 위 트랙(표시 순서).
- 입력 검증: 숫자 아님, 음수, 10초 초과는 입력칸에 인라인 오류와 원래 값 유지(엔진 규격: 0~10000ms).
- In과 Out은 효과, Delay, Duration을 각자 갖는다(`--sk-out-*` 변수, 없으면 In 값으로 폴백).

## 2. 요소 선택과 막대 선택의 연결(양방향)

- **캔버스(또는 Layers)에서 요소 선택 → 타임라인**: 그 요소의 트랙(둘일 수 있음)을 강조하고 첫 트랙을 화면 안으로 스크롤(접힌 구역은 펼침). 애니메이션이 없는 요소를 선택하면 마지막 구역 아래에 점선 **유령 트랙** `Title — Add animation`(클릭하면 새 클릭으로 In 추가).
- **막대 선택 → 캔버스**: 막대를 누르면 막대 강조는 **즉시**, 그 요소의 캔버스 선택은 다음 프레임에 이어진다(요소 선택 비용이 CPU 4배에서 약 1.3초라 막대가 늦게 반응하면 안 됨).
- 같은 요소의 In과 Out은 선택 시 둘 다 연한 강조, 눌린 막대는 진한 강조. 트랙 라벨 호버 → 캔버스 요소에 외곽선.

## 3. 재생 헤드와 스크럽 (전환 프레임 정확)

### 3.1 동작

- 구역의 눈금자를 누르거나 끌면 그 구역의 시간 t로 헤드가 간다. 캔버스: 앞선 모든 구역은 끝난 상태, 이 구역은 t 시점의 **실제 전환 중간 프레임**(opacity, transform, filter, 지연 포함).
- 구역 머리줄 `▶`는 그 구역만 재생, 도구줄 `Play`는 슬라이드 전체(구역 사이 `Click` 대기 표식, 0.6초 뒤 자동 진행, 재생 중 헤드가 눈금을 따라 움직임, `Stop` 시 마지막 상태로 복귀).
- 헤드 기본은 "끝". 도구줄 `Click ◂ 2/3 ▸`는 구역 끝 정지 상태를 순서대로 본다. 시간 표시 `Click 2 · 0.35s`는 `aria-live=polite`.

### 3.2 구현 방식(확정): 엔진의 실제 CSSTransition을 멈춰 쓴다

1. 스크럽 시작(구역 k): 앞 단계(k−1) 상태를 `data-step-instant`로 즉시 맞춘다(지금 `applyPlayhead(instant)`와 같음).
2. 단계 k의 `data-shown`/`data-away`(퇴장 후는 `data-away="out"`)를 전환 허용 상태로 토글한다 → 엔진 CSS가 실제 전환(시간, 지연, 이징, 속성)을 시작한다.
3. `slide.getAnimations({subtree:true})`에서 `CSSTransition`만 골라 전부 `pause()`(getAnimations가 스타일 갱신을 강제하므로 별도 reflow 불필요).
4. 헤드 이동마다 각 `CSSTransition.currentTime = t`(클릭 시점부터의 ms, 지연 구간 포함이라 Delay와 그대로 맞음)만 바꾼다. DOM 속성은 건드리지 않는다.
5. 스크럽 끝: 모든 전환 `cancel()` → 요소는 단계 k의 최종 상태(CSS가 정한 값)로 돌아오고 정상 헤드 상태가 복원된다.

엔진 CSS 정의를 편집기에서 중복하지 않으므로 이징, 시간, 지연이 **항상 엔진과 일치**한다(Delay, Duration, 퇴장 변수가 바뀌어도 코드를 고칠 필요 없음). 새 라이브러리 없음(브라우저 내장 Web Animations 인터페이스).

### 3.3 스파이크 결과 (`/tmp/slidekit-anim-ux2/scrub-spike.cjs`, 일회성, 러너 잠금)

실제 편집기 iframe에서 합성 덱(In: Delay 0.2s·Duration 1.0s와 0.6s, Out: 0.6s, 별도 In 0.36s)으로 클릭 1→2, 2→3 두 구역을 t = 0, 100, 200, 300, 500, 700, 1000, 1200, 1500ms에서 측정. 기대값은 엔진 `--sk-ease`(cubic-bezier(0.22,1,0.36,1))를 직접 계산한 opacity와 translateY.

| 항목 | Chromium | WebKit 2370 |
|---|---|---|
| `CSSTransition`, `getAnimations` 지원 | 예 | 예 |
| 일시정지 + `currentTime` 설정이 계산 스타일에 반영 | 예 | 예 |
| 측정 36점(opacity와 transform) 중 기대와 어긋난 점(허용 오차 opacity 0.03, ty 1px) | **0** | **0** |
| 스크럽 중 DOM 속성 변경(MutationObserver) | **0건** | **0건** |
| 끝에서 `cancel()` 뒤 최종 상태(In: opacity 1/ty 0, Out: opacity 0/ty 20) | 일치 | 일치 |
| 끝난 뒤 남은 애니메이션 | 0 | 0 |
| 생성된 전환 | opacity, transform(+ 퇴장 요소의 visibility) | 같음 |

샘플(Alpha, Delay 200ms, Duration 1000ms): t=200 → opacity 0, ty 20(지연 끝); t=300 → 0.401, 11.98; t=500 → 0.832, 3.36; t=1000 → 0.999, 0.03. 2순위(`el.animate`)는 필요 없다.

주의: ① 값이 안 바뀌는 속성은 전환이 생기지 않는다(정상). ② `getAnimations()`가 스타일 갱신을 강제하므로 스크럽 시작 순간 한 번 비용이 있다(요소 100개 구역 시작 시 측정 항목으로 둠). ③ 스크럽 중에는 재생 헤드 외부 저장소의 `applyStep` 구독이 속성을 건드리지 않도록 스크럽 상태일 때 잠근다. ④ 스크럽 중 편집(막대 끌기)과 겹치지 않게 스크럽은 끌기를 시작하면 종료한다.

## 4. 추가와 삭제

- 요소 우클릭(캔버스, Layers) 메뉴 `Animate ▸ In / Out`, 인스펙터 `+ In`, `+ Out`, 도구줄 `Add animation`(선택 요소에 In, 이미 있으면 Out), 유령 트랙 클릭, 빈 시간 영역 더블클릭.
- 기본값: In = **마지막 구역 다음의 새 클릭**, Delay 0, Duration 0.36s, Effect Rise. 기존 요소는 건드리지 않는다. Out = 자기 In 뒤의 새 마지막 클릭.
- 삭제: 막대 선택 후 `Delete`/`Backspace`, 막대 우클릭 `Delete`(휴지통 아이콘, 단축키 표기). 구역에 막대가 없어지면 구역이 사라진다(남은 번호는 그대로, 엔진이 압축).
- 모든 조작은 실행 취소 한 건.

## 5. 빈 상태, 오류 표시, 접근성

### 5.1 상태 목록

| 상태 | 표시 |
|---|---|
| 빈 슬라이드 | 가운데 `No animations yet. Select an element, then press Add animation.` + `Add animation`(선택 없으면 비활성 + `Select an element first` 힌트) |
| 정상 | 5.2 스케치 1 |
| 호버(막대) | 크기 조절 커서, 툴팁 `Fade · starts with previous · delay 0.20s · lasts 0.40s` (관계 문구는 숫자에서 유도, 아래 6절) |
| 선택(막대) | 진한 외곽선 + 인스펙터 갱신, 같은 요소의 다른 막대는 연한 강조 |
| 키보드 포커스 | 막대 바깥쪽 2px 포커스 링 |
| 끌기(이동/크기) | 반투명 막대 + 칩 `Delay 0.25s` / `Duration 0.40s` |
| 스냅 중 | 세로 안내선 + 칩 `With previous · Title` 또는 `After previous · Title` |
| 구역 이동 중 | 대상 구역 강조, 구역 사이 `New click` 점선, 금지 구역은 빗금 + 칩 이유 |
| 재생 중 | 헤드가 눈금을 따라 이동, 현재 구역 강조, `Play`가 `Stop`으로 |
| 스크럽 중 | 헤드와 시간 `Click 2 · 0.35s`, 캔버스는 전환 프레임 표시 |
| 잘못된 속성 요소 | 맨 위 경고 줄 `⚠ Alpha: Out (click 2) is not after In (click 3). Fix`(`Fix`가 값을 고침) |
| 범위 초과 | 눈금 끝 `→ 3.2s` 칩(클릭하면 Fit) |
| 읽기 전용 / stepper 슬라이드 | 위 띠 `This slide uses a custom stepper. The timeline is read-only.` (엔진이 `data-stepper`를 붙이는 안은 결정 21 대기, 그 전에는 스크립트 글자 검색) |
| 저장 충돌 | 기존 띠 `File changed outside the editor`(Reload, Overwrite)를 그대로 사용 |

### 5.2 ASCII 스케치

**스케치 1. 기본(두 번 클릭)**

```
 Notes | Animation        [▶ Play]  Click ◂ 1/2 ▸  0.00s   [− + Fit] [?]   [+ Add animation]
 ┌────────────────────┬──────────────────────────────────────────────────────────────┐
 │ ▾ Click 1  0.0–0.8s│ 0     0.25    0.5     0.75    1.0     1.25    1.5    s    ▶ │
 ├────────────────────┼──────────────────────────────────────────────────────────────┤
 │ ◗▸ Title      In   │┆▕████ Fade 0.4s ███▏                                          │
 │ ◗▸ Photo      In   │┆▕████ Rise 0.6s ██████▏   ← 같은 시작 (With previous)         │
 │ ◗▸ Caption    In   │┆            ▕███ Fade 0.4s ███▏  ← Title 끝에 붙음 (After previous)│
 │                    │┆ Click                                                        │
 ├────────────────────┼──────────────────────────────────────────────────────────────┤
 │ ▾ Click 2  0.0–0.4s│ 0     0.25    0.5     0.75    1.0     1.25    1.5    s    ▶ │
 ├────────────────────┼──────────────────────────────────────────────────────────────┤
 │ ▸◖ Photo      Out  │┆▕███▒ Fade 0.4s ▒▏   (Out: 오른쪽이 비스듬)                   │
 ├────────────────────┴──────────────────────────────────────────────────────────────┤
 │  ┄┄ New click: drop a bar here ┄┄                                                  │
 └──────────────────────────────────────────────────────────────────────────────────┘
```

**스케치 2. 끌기 중(자석 스냅과 안내선)**

```
 │ ◗▸ Title      In   │┆▕████ Fade 0.4s ███▏                                          │
 │ ◗▸ Photo      In   │┆▕████ Rise 0.6s ██████▏                                       │
 │ ◗▸ Caption    In   │┆             ┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐  (끄는 중, 반투명)             │
 │                    │┆             ╎ Delay 0.40s    ╎                              │
 │                    │┆             └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘                              │
 │                    │┆         ┊ ← 안내선(Title 끝 0.40s에 스냅)                     │
 │                    │┆      ╭──────────────────────────────╮                       │
 │                    │┆      │ After previous · Title       │  ← 스냅 칩             │
 │                    │┆      ╰──────────────────────────────╯                       │
```

**스케치 3. 구역 이동(금지 구역은 빗금)**

```
 │ ▾ Click 1          │ ... Title(In)  Photo(In)                                      │
 │ ▾ Click 2   ◀ 놓을 수 있음(강조) ┌╌╌╌╌╌╌╌┐ ← 끄는 중인 Photo(Out)                  │
 │ ░░ Click 3 (Photo의 In보다 뒤가 아니면 빗금 = 금지) ░░ Out must come after In ░░   │
 │  ┄┄ New click: drop here to make Click 3 ┄┄                                        │
```

**스케치 4. 빈 상태와 유령 트랙(요소 선택 중)**

```
 │                No animations yet.                                                  │
 │        Select an element, then press Add animation.                               │
 │ ┌ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┐                                                          │
 │ ┆ ＋ Title — Add animation ┆   (클릭하면 새 클릭으로 In이 생김)                       │
 │ └ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┘                                                          │
```

**스케치 5. 좁은 패널(왼쪽 열 96px, 가로 스크롤)**

```
 │ ▾ Click 1 │ 0   0.5   1.0  ›    │  ← 시간 영역은 가로 스크롤, Fit으로 맞춤
 │ ◗▸ Title  │▕███▏                │
 │ ◗▸ Photo  │▕████▏               │  막대 글자는 툴팁/포커스에서만
```

**스케치 6. 오류와 스크럽**

```
 │ ⚠ Alpha: Out (click 2) is not after In (click 3).   [Fix]                         │
 │ ▾ Click 2 │ 0   0.25  ▼0.35  0.5 ...     ← 스크럽 헤드(▼), 캔버스는 0.35s의 전환 프레임   │
```

### 5.3 접근성

- 타임라인 `role="region" aria-label="Animation timeline"`, 구역 `role="group" aria-label="Click 2, 0.0 to 0.8 seconds"`, 트랙 `role="list"/"listitem"`, 막대 `role="button"` + `aria-roledescription="animation bar"`.
- 막대 이름 예: `Title, In, Fade, delay 0.20 seconds after click 1, lasts 0.40 seconds, starts with previous`.
- 키보드(**roving tabindex**: 타임라인 전체가 탭 정지 하나, ↑↓로 막대 이동): `←/→` Delay ±0.05s, `Shift+←/→` Duration ±0.05s, `Alt+↑/↓` 이전/다음 클릭 구역(맨 끝에서 `New click`), `Home` Delay 0, `Delete` 삭제, `Enter` 캔버스 요소 선택, `W` With previous, `A` After previous(툴팁과 단축키 안내에 표기). 0.7초 안의 연속 방향키는 실행 취소 한 건으로 합친다.
- `aria-live=polite` 알림: `Title delay 0.25 seconds in click 1`, `Title moved to click 2`, `Out must come after In`.
- 색 의존 없음(모양, 아이콘, 라벨). 포커스 링 2px, 대비 4.5:1. 움직임 줄이기면 재생 헤드 이동 애니메이션 없이 상태만 바뀐다. 터치: pointer 이벤트, 가장자리 손잡이 12px.

## 6. 용어 조사와 확정안

### 6.1 조사표 (같은 개념을 부르는 말, 확인한 출처)

| 개념 | PowerPoint | Keynote | Google Slides | Figma Slides | Canva | reveal.js / Slidev |
|---|---|---|---|---|---|---|
| 요소가 나타남/사라짐 | 효과 범주(Entrance/Exit 계열: 지원 문서는 "Appear on the slide", "Exit the slide") | Build In / Build Out | Appear(기본 `Appear (On click)`) 등 효과 | Animate: "animate in or out of view" | 인트로/아웃트로 | fragment fade-in / fade-out (Slidev `v-click`, `.hide`) |
| 클릭 단위로 시작 | Start: **On Click** | Start: **On Click**("the first plays with the first click") | **On click** | Timing: **On click**(첫 애니메이션 기본) | "Appear on click" | fragment 인덱스, Slidev click 번호 |
| 앞과 동시에 | **With Previous** | **With Build [number]**(iOS: With Previous) | **With previous** | (공식 문서에 없음, 포럼 요청) | 타임라인 겹침 | 같은 fragment index가 함께, Slidev `v-after` |
| 앞이 끝난 뒤 | **After Previous** | **After Build [number]**(iOS: After Previous) | **After previous** | **After previous** | 타임라인 이어붙임 | Slidev `+1` 상대 위치 |
| 기다리는 시간 | **Delay** | **Delay** | (없음, 속도 슬라이더만) | (없음) | 타임라인 시작 손잡이 | - |
| 걸리는 시간 | **Duration** | Duration(iPad: Options) | Speed 슬라이더 | **Duration** | Slow/Medium/Fast, 초 단위 | - |
| 목록/타임라인 | Animation Pane(번호 표시, 겹치면 "numbered stack") | Build Order | Motion 패널 | Animate 탭의 목록 | **Show element timing**(막대, 핸들 끌기) | - |
| 미리보기 | Play From | Play | Play | Play animations | Play | - |

출처(확인일 2026-10-17): PowerPoint https://support.microsoft.com/en-au/powerpoint/training/animate-text-or-objects (Start: On Click / With Previous / After Previous, Duration, Delay, Animation Pane, "Appear on the slide"/"Exit the slide"). Keynote https://support.apple.com/guide/keynote/tan3ad5f8d82/mac (On Click, With Build [number], After Build [number], After Transition, Delay, Build Order), https://help.apple.com/keynote/mac/6.2/en.lproj/tan72234bb6.html (Build In, Build Out), iOS 표기는 검색 요약(On Tap / With Previous / After Previous). Google https://support.google.com/docs/answer/1689475 (On click / After previous / With previous 정의, Speed, `Appear (On click)`). Figma https://help.figma.com/hc/en-us/articles/30601608159383 (Animate 탭, Add animation, Duration, Timing: On click / after previous, Animate in or out, 요소당 하나) 와 포럼 https://forum.figma.com/suggest-a-feature-11/slides-animate-with-previous-and-after-transition-46708. Canva https://www.canva.com/help/edit-element-timing/ (페이지 접근이 막혀 검색 요약 사용: Show element timing, 핸들로 길이 조절, Appear on click). reveal.js https://revealjs.com/fragments/ (fragment, fade-in, fade-out, 같은 data-fragment-index는 함께). Slidev https://sli.dev/guide/animations (`v-click`, `v-after`, `v-clicks`, 상대 `+1`, `.hide`).

### 6.2 판단과 확정

- **Start 관계**: 가장 통상적인 한 조합은 **On click / With previous / After previous**다(PowerPoint, Google Slides 그대로, Keynote 모바일 같음, Figma는 On click과 After previous). Keynote Mac의 With Build/After Build 쪽이 소수. 사용자가 "이해가 안 된다"고 했으므로 이름은 통상어를 쓰되 **모든 노출 지점에 한 줄 설명(툴팁)을 붙이고**, 타임라인에서는 관계를 막대 정렬로 바로 보여 말에 의존하지 않게 한다. 구역 이름은 "Click 1"(Keynote 설명 "the first plays with the first click", Slidev의 click 번호와 같은 말).
- **들어옴/나감**: In / Out. 근거: Keynote Build In/Out, Figma "in or out of view", reveal.js fade-in/fade-out이 같은 뿌리이고 가장 짧다(PowerPoint의 Entrance/Exit 범주는 효과 목록 이름이라 막대 이름에 길다). 툴팁으로 "enters / leaves"를 설명.
- **기다리는 시간**: **Delay**(PowerPoint, Keynote 공통, 개정 1의 "Start"는 폐기). **Duration**은 PowerPoint, Keynote, Figma 공통. 효과 이름 Fade, Rise, Slide, Scale, Blur는 유지.
- 개정 1의 Together/Then, Appear/Disappear는 폐기.

### 6.3 최종 어휘 (영어 UI 문구 / 한국어 설명 / 툴팁 한 줄)

| 영어 UI | 한국어 설명 | 툴팁(영어, 한 줄) |
|---|---|---|
| Animation | 탭 이름 | - |
| Click 1, Click 2 ... | 발표 중 n번째 클릭(또는 → 키)에 재생되는 묶음 | `Plays when you click (or press →) for the 1st time while presenting.` |
| In | 요소가 나타남(들어옴) | `The element enters (appears) at this click.` |
| Out | 요소가 사라짐(나감) | `The element leaves (disappears) at this click. It must come after its In.` |
| Effect: Fade, Rise, Slide, Scale, Blur | 움직임의 모양 | `How the element moves in or out.` |
| Delay `0.20s` | 클릭 뒤 기다리는 시간(막대의 왼쪽 위치) | `Seconds to wait after the click before this starts.` |
| Duration `0.40s` | 걸리는 시간(막대 길이) | `How long this takes.` |
| Click (인스펙터 셀렉트) | 어느 클릭에 재생할지 | `Which click plays this. "New click" makes a new one.` |
| With previous (단추, 칩) | 위 막대와 같은 시작(Delay 복사) | `Start at the same time as the bar above (copies its Delay).` |
| After previous (단추, 칩) | 위 막대가 끝난 뒤 시작(Delay + Duration) | `Start when the bar above ends (its Delay + Duration).` |
| On click (막대 툴팁 관계 문구) | Delay 0이면 `Starts on click` | `Starts as soon as you click.` |
| New click | 새 클릭 구역 | `Drop a bar here to add a new click.` |
| Play / Stop | 슬라이드 전체 재생 | `Play all clicks. A short pause stands for each click.` |
| Add animation | 선택한 요소에 In(있으면 Out) 추가 | `Add an In (or Out) animation to the selected element.` |
| Fit / Zoom | 시간 눈금 맞춤과 확대 | - |

막대 툴팁의 관계 문구는 **숫자에서 유도**한다: Delay 0 → `Starts on click`; 같은 구역 위 트랙과 Delay가 같으면 `Starts with previous`; 위 트랙의 끝과 같으면 `Starts after previous`; 아니면 `Starts 0.35s after the click`.

도구줄 `?`(How timing works): 작은 팝오버 세 줄과 그림(막대 둘이 같은 시작 = With previous, 이어짐 = After previous, 왼쪽으로 밀림 = Delay)로 개념을 한 번에 설명한다(첫 사용 때 한 번 자동으로 열림, 다시 안 띄움을 기억).

### 6.4 파일 속성과의 대응 (A+)

| 화면 | 파일 |
|---|---|
| In / Out | `data-step` / `data-step-out`(번호는 엔진이 압축해 Click n으로 센다) |
| Delay | `--sk-step-delay` / `--sk-out-delay` |
| Duration | `--sk-step-ms` / `--sk-out-ms` |
| Effect | `--sk-away-*` / `--sk-out-opacity|x|y|scale|blur` 값 채움(이름은 저장 안 함, Out 변수가 없으면 In 값으로 폴백) |
| With previous / After previous | **저장 안 함**(숫자만) |

## 7. 성능 예산 (요소 100개, 클릭 20개, CPU 4배 느림)

| 항목 | 예산 | 방법 |
|---|---|---|
| 탭 열기 | 800ms 이내(지금 목록은 약 2.2초) | 트랙당 노드 4~6개, 줄마다 셀렉트 없음, 줄 컴포넌트 memo |
| 끌기 | 프레임 간격 p95 100ms 이내, 긴 작업 0건 | 포인터 이동에서 막대 `transform/width`와 안내선만 직접 갱신, rAF 합침, 스냅 후보는 구역 안 막대만 미리 계산 |
| 놓기 후 반영 | 5초 이내(현재 저장 비용 기준) | 바뀐 요소만 쓰고 한 번 커밋 |
| 막대 선택 반응 | 막대 강조는 한 프레임, 캔버스 선택은 이어서 | 타임라인 강조는 지역 상태, 캔버스 선택은 rAF 뒤 |
| 스크럽 | 헤드 이동 한 번 = 전환 `currentTime` 설정뿐(DOM 변경 0), 프레임당 p95 16ms(CPU 1배)/100ms(4배) | 3절. 시작 순간 `getAnimations()` 한 번 비용을 측정해 한도(100요소 구역에서 200ms)를 정함 |
| DOM 노드 수 | 구역당 20 + 트랙당 6, 총 1500 이하 | 가상화 불필요. 구역마다 `content-visibility:auto`와 `contain-intrinsic-size` |
| 눈금 | 눈금선은 CSS repeating-linear-gradient 한 장, 라벨만 노드 | |

가상화는 구역이 100을 넘을 때만 필요하며 v1에서는 하지 않는다.

## 8. 작은 화면과 긴 슬라이드

- 패널 폭이 좁으면 왼쪽 열 96px, 이름 말줄임(툴팁). 시간 영역은 가로 스크롤, `Fit`이 가장 긴 막대에 맞춘다.
- 구역이 많으면(20개) 선택 요소가 있는 구역과 헤드 구역만 펼치고 나머지는 한 줄 요약(`Click 7 · 3 animations · 0.0–0.6s`)으로 접어 시작, `Click ◂ ▸`와 `Jump to ▾`로 이동, 모두 펼치기/접기.
- 패널 높이는 Animation 탭을 처음 열 때 280px(끌어서 조절, 기억), 자동 접기는 구역 10개 초과 때.
- 10초를 넘는 값(손편집)은 눈금이 10초에서 끊기고 막대는 `→` 칩, 인스펙터에서만 편집.

## 9. 비교 앱에서 따올 것과 버릴 것

| 앱 | 따올 것(근거) | 버릴 것(근거) |
|---|---|---|
| PowerPoint 애니메이션 창과 고급 타임라인 | 항목마다 막대, 위치와 길이로 시작과 시간, 시작 방식 용어(통상어), 막대 끌기 | 사이드바 폭에 갇힌 타임라인, 번호 매기기, 시작 방식 드롭다운(우리는 막대 정렬이 곧 표현) |
| Keynote Build Order | 클릭 단위 묶음의 단순함, 한 줄 설명 | 시간 개념 없는 순수 목록(사용자가 시간 축이 없어 답답했다는 문제) |
| After Effects / Figma 타임라인 | 눈금자, 헤드 스크럽, 막대 가장자리 끌기, 스냅과 안내선, 줌 | 키프레임과 곡선 편집, 무한 줌, 레이어 순서 |
| Canva `Show element timing` | 막대 핸들로 길이와 시작을 직접 끌기(사용자 대상이 비전문가) | 선택한 요소 하나만 보이는 타임라인(우리는 구역 전체를 한눈에) |
| Figma Slides | 요소 선택 후 인스펙터에서 효과, 길이, 시작을 한 곳에서, "Add animation" 문구 | 요소당 하나만(우리는 In과 Out 둘) |

## 10. 데이터 모델 대응(A+)과 순수 모델 API

- 막대 = `{ id(요소, in|out), click(압축 순위), delay(ms), duration(ms), effect(away/out 값) }`. 읽기: `data-step`(In), `data-step-out`(Out), 지연과 시간 변수(Out은 `--sk-out-*`, 없으면 In 값 폴백). 클릭 순위 = 쓰인 단계 번호의 정렬 순위.
- 순수 함수(단위 테스트, 값은 ANIMATION.md 표 기준): `buildTimeline`, `moveBar(delay)`, `resizeBar(duration | delay+duration)`, `moveToClick(n | new)`, `snapTargets(click, bar)`, `relationOf(bar, above)`(툴팁 문구용), `validate`(Out 순위 > In 순위, 범위 0~10000ms, 50ms 스냅).
- 쓰기: 바뀐 요소만, 한 조작 = 실행 취소 한 건. 새 구역은 인접 번호 사이 **중간 정수**를 쓰고(다른 요소를 다시 쓰지 않음), 없을 때만 뒤 번호를 다시 매긴다. 정규화 저장은 하지 않는다.
- 현재 목록 UI의 `buildList/layout/edit`와 `AnimationPanel`의 줄 목록은 폐기 대상(파서 `parse`와 별칭 처리는 유지).

### 엔진과 합의한 것 (engine-dev, ANIMATION.md 608fb4c)

- 퇴장 변수 `--sk-out-opacity|x|y|scale|blur`, `--sk-out-ms`, `--sk-out-delay`(없으면 In 값 폴백), 되감기는 지연 무시(In/Out 공통).
- **숫자가 진실**. 규격의 `data-step-start`는 "의도 힌트, 숫자가 진실, 런타임 미사용, 막대를 끌면 지움"이며 이 설계는 속성 없이(읽히면 무시, 쓰지 않음) 간다. **After 계산은 하지 않고 숫자 복사**(사용자 확정).
- 단계 번호: 빈칸 허용, 엔진 압축. 퇴장 유효성은 순위 비교. `data-steps`는 선언형 슬라이드에서 엔진이 무시, 편집기는 읽지도 지우지도 않음.
- 값 범위 0~10000ms(엔진 clamp, lint 오류), 다음 클릭은 전환을 기다리지 않음.
- `data-away=""`(등장 전)/`"out"`(퇴장 후): 편집기 재생 헤드가 같은 값을 써서 Out 모양을 그린다(스크럽 3.2의 2단계와 일치). 저장 글자에서는 항상 지운다.
- 공용 순수 모듈 `engine/anim-core.ts`(결정 19)는 승인 뒤 engine-dev가 만들고 알려 준다. stepper 표식 `data-stepper`(결정 21)는 대기.

## 11. 위험과 열린 문제 (결정이 아니라 구현 중 확인할 것)

1. **스크럽 시작 비용**: 요소 100개 구역에서 `getAnimations()` 한 번의 비용을 측정해 한도를 정한다(7절).
2. **막대 겹침이 많은 슬라이드**: 같은 시각에 20개가 시작하면 세로로 길어진다(구역 접기와 줌으로 대응).
3. **이름 없는 요소**: `Text`, `Image`, `Auto layout`처럼 종류 이름이라 구분이 어렵다 → 트랙 라벨을 더블클릭해 이름 바꾸기(Layers와 같은 `data-name`), 빈 이름 힌트.
4. **번호 전파**: 두 클릭 사이에 정수가 없을 때(2,3 사이에 끼우기)만 뒤 번호를 다시 쓴다(드물다. 반복되면 변경 소음).
5. **외부 변경 충돌**: 퍼즈에서 외부 변경 뒤 첫 저장이 409(`File changed outside the editor`)로 막힌 사례가 있다(Overwrite 또는 Reload로 풀림). 조건 조사는 별도 항목이고 타임라인은 이 띠를 그대로 쓴다.
6. **다중 선택 이동의 클램프**: 한 막대가 0에 닿으면 전체가 멈춘다(상대 간격 유지).

## 12. 확정된 결정과 구현 순서

사용자 승인 필요 목록: **없음**(전부 확정).

확정: ① 용어는 조사한 통상 조합(6절). ② 클릭 구역 세로 쌓기. ③ 줄 순서는 시작 시간순 자동. ④ 스냅 0.05s + 자석 스냅(Alt 0.01s). ⑤ 구역 간 끌기와 `New click` 허용. ⑥ 스크럽은 전환 프레임 정확(3절, 스파이크 통과). ⑦ 관계는 저장하지 않고 숫자만. ⑧ 새 애니메이션은 마지막 구역 다음의 새 클릭. ⑨ Out 별도 효과 노출(`--sk-out-*`). ⑩ 패널 높이 280px와 구역 10개 초과 때 자동 접기. ⑪ 방향과 이징은 후속. ⑫ 기존 목록 UI는 폐기하고 타임라인만 둔다.

구현 순서(승인 뒤): (1) 순수 모델 + 단위 테스트(ANIMATION.md 표 기준, 왕복, 압축, 스냅 후보) → (2) 읽기 전용 타임라인 렌더(트랙, 막대, 눈금, 구역) → (3) 선택 연결과 인스펙터 → (4) 끌기, 스냅, 구역 이동 → (5) 스크럽과 Play → (6) 키보드와 접근성 → (7) e2e(editor-animation 새 시나리오, Chromium과 WebKit), 성능(editor-anim-perf 새 항목), 퍼즈(a5 변형) → (8) 목록 UI 제거와 문서(SPEC 9.7, INSPECTOR, ANIMATION 4절).
