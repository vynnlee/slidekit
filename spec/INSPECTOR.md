# 속성 패널(Inspector) 재설계 조사

편집기 우측 속성 패널을 Figma Design 패널과 같은 구조로 다시 만들기 위한 조사 문서다. 구현은 끝났고 이 문서는 설계 근거로 남긴다(현재 동작은 `app/src/components/inspector/README.md`와 코드를 따른다). 본문은 한국어, UI 문구는 영어다(다국어 없음).

표기: "확인"은 공식 문서에서 읽은 것, "미확인"은 공식 문서로 못 찾은 것, "제안"은 이 문서의 설계 결정이다.

## 0. 출처

| 약칭 | URL | 읽은 내용 |
|---|---|---|
| F1 | https://help.figma.com/hc/en-us/articles/360039832014 | Design 패널 섹션 순서 |
| F2 | https://help.figma.com/hc/en-us/articles/360039956914 | 정렬, 위치, 회전, W/H, 비율 잠금, 스크럽, 넛지, 수식, Mixed |
| F3 | https://help.figma.com/hc/articles/360040451373 | Auto layout 방향, 간격, padding, 정렬, Fixed/Hug/Fill, min/max |
| F4 | https://help.figma.com/hc/en-us/articles/360039957734 | Constraints |
| F5 | https://help.figma.com/hc/en-us/articles/360039956634 | 텍스트 속성 |
| F6 | https://help.figma.com/hc/en-us/articles/360041488473 | 그림자와 블러 효과 |
| F7 | https://help.figma.com/hc/en-us/articles/360041003694 | Fill과 Stroke 기본 |

검색으로만 확인한 항목(공식 본문 미열람)은 해당 칸에 "검색 요약"으로 적었다. 정확한 픽셀 규격(행 높이, 라벨 폭, 열 폭)은 공식 문서에 없다. 아래 수치는 모두 "제안"이다.

## 1. Figma Design 패널 구조

### 1.1 섹션 순서 (확인, F1)

레이어를 선택했을 때 Design 탭 위에서 아래로:

| 순서 | 섹션 | 비고 |
|---|---|---|
| 1 | Alignment, rotation, position | 정렬 바, X/Y, 회전 |
| 2 | Frame size and orientation | W/H, 비율 잠금 |
| 3 | Corner radius | |
| 4 | Constraints | 프레임 안의 레이어만 |
| 5 | Layout guides | |
| 6 | Component properties | |
| 7 | Instance | |
| 8 | Auto layout | |
| 9 | Blend modes (Appearance) | |
| 10 | Text | 텍스트 레이어만 |
| 11 | Fill | |
| 12 | Stroke | |
| 13 | Effects | |
| 14 | Export settings | |

아무것도 선택하지 않았을 때(확인): 로컬 스타일과 변수, 캔버스 배경색, 페이지 전체 내보내기.

Figma 포럼에는 "Position, Auto layout, Appearance가 관련 없는 속성을 한 섹션에 묶는다"는 사용자 불만이 있다(검색 요약, 공식 변경 아님). 우리는 CSS 박스 모델에 맞춰 묶음을 정리해도 된다.

### 1.2 섹션별 컨트롤

| 섹션 | 컨트롤 | 확인 여부 |
|---|---|---|
| Alignment | 좌, 가로 중앙, 우, 상, 세로 중앙, 하 6개 아이콘 버튼. 한 개 선택이면 부모 기준, 여러 개면 서로 기준. Shift+클릭은 그룹 전체를 부모에 정렬. 단축키 Alt+A/D/W/S/H/V | 확인 F2 |
| Position | X, Y. 레이어 경계의 좌상단 기준. 회전해도 원래 좌상단 기준 | 확인 F2 |
| Rotation | 각도 필드. 반시계 양수, -180 ~ 180. Shift는 15도 단위 스냅 | 확인 F2 |
| Dimensions | W, H. 비율 잠금 토글(Layout 또는 Auto layout 섹션). 잠금 중 한쪽을 고치면 다른 쪽이 따라감 | 확인 F2 |
| Resizing | Fixed(고정), Hug contents(자식에 맞춤), Fill container(부모를 채움). 각 축마다. min/max는 W/H 드롭다운의 "Add min width" 등 | 확인 F3 |
| Constraints | 가로: Left, Right, Left and Right, Center, Scale. 세로: Top, Bottom, Top and Bottom, Center, Scale. 기본 Top, Left | 확인 F4 |
| Auto layout | 방향 Vertical, Horizontal, Grid. Wrap. 간격(숫자 또는 Auto: Between, Around, Evenly). Padding(전체, 가로/세로, 4변 개별). 정렬 박스(3x3). Ignore auto layout(옛 이름 absolute position). Clip content | Clip content는 F3에 없음, 미확인(일반 지식으로 Layout 섹션 체크박스) |
| Corner radius | 숫자 하나, 개별 모서리 4개로 펼침 | 검색 요약(위치는 회전 바로 아래) |
| Appearance | Opacity(%), Blend mode, Corner radius를 같은 섹션에 둔다 | UI3 배치는 미확인(포럼 불만 글 기준) |
| Typography | 텍스트 스타일, font family, weight(style), size, line height(Auto 기본, px 또는 %), letter spacing(%, px), 가로 정렬 left/center/right/justify, 세로 정렬 top/middle/bottom(고정 크기 텍스트만), 줄임(Truncate), 더보기 버튼으로 Type settings 패널 | 확인 F5 |
| Type settings | Basics, Details, Variable 탭. 장식(underline, strikethrough과 스타일, 두께, 오프셋), 대소문자(Upper, Lower, Title, Small caps), 문단 간격, 들여쓰기, OpenType | 확인 F5 |
| Text resizing | Auto width, Auto height, Fixed. Typography가 아니라 Layout 섹션에 있다 | 확인 F5 |
| Fill | 스와치 클릭 시 색 선택기. 종류 Solid, Gradient, Pattern, Image, Video. 스와치 옆 불투명도 필드. 눈 아이콘으로 표시 토글. +로 추가, -로 제거 | 확인 F7 |
| Stroke | +로 추가(기본 Solid), -로 제거. 위치 Inside, Center, Outside, 두께, 변별 개별, 대시 | +/- 확인 F7, 나머지는 F7에 없고 일반 지식(미확인) |
| Effects | Drop shadow, Inner shadow(각 최대 8개), Layer blur, Background blur(각 1개). 그림자는 X, Y, Blur, Spread, 색과 불투명도. 효과별 설정 아이콘으로 팝오버. 드래그로 순서 변경. +로 추가 | 확인 F6 |
| Export | 형식과 배율 | 목록만 확인(F1) |

### 1.3 컨트롤 모양 규칙

| 규칙 | 내용 | 확인 여부 |
|---|---|---|
| 스크럽 | 숫자 필드의 라벨(또는 아이콘) 위에 커서를 올리면 스크럽 커서로 바뀐다. Alt/Option을 누르고 필드 위에서 드래그해도 된다. 오른쪽 드래그는 증가, 왼쪽은 감소. 커서를 화면 위쪽으로 옮기면 빠르게(2x), 아래쪽이면 느리게(1/2, 1/4) | 확인 F2 |
| 넛지 | 화살표 키는 작은 넛지(기본 1), Shift+화살표는 큰 넛지(기본 10). 이 값은 캔버스 이동 기준이며 필드 안의 화살표 동작도 같은 단위로 쓰는 것이 관례 | 캔버스 넛지 확인 F2, 필드 안 화살표는 미확인 |
| 수식 | 위치, 크기, 회전 필드는 `+ 10`, `*2`, `/4`, `(x/2)+6` 같은 수식을 받는다. 필드를 선택한 채 수식만 치면 값을 덮어쓰고, 기존 값 뒤에 이어 쓰면 계산한다 | 확인 F2 |
| Mixed | 여러 레이어를 선택해 값이 다르면 필드에 "Mixed"를 보인다. 거기에 `Mixed+100` 같은 수식을 쓰면 각 레이어에 적용된다 | 확인 F2 |
| 라벨 | 숫자 입력 앞에 한 글자(X, Y, W, H) 또는 아이콘(회전, 모서리). "Property labels" 옵션(줌 드롭다운)으로 라벨 표시를 켠다 | 확인 F1, 한 글자 규칙은 UI 관찰 기반이라 공식 문서 미확인 |
| 2열 그리드 | 한 행에 필드 2개(X/Y, W/H). 공식 문서에 규격 없음 | 미확인 |
| 행 높이 | 24 ~ 32px 컴팩트 | 미확인(요청서 가정) |
| 섹션 헤더 | 제목 오른쪽 +/- 버튼으로 항목 추가와 제거. 접기 | +/-는 확인 F6, F7. 섹션 접기는 미확인 |
| 호버 노출 | 레이어 행의 눈, 잠금처럼 호버 때만 보이는 버튼 | 미확인 |
| 비율 잠금 | 링크 아이콘 토글. Ctrl로 일시 해제, Shift로 일시 잠금 | 확인 F2 |

## 2. Figma 컨트롤을 CSS로 옮기는 매핑

전제: 슬라이드는 1920x1080 고정 무대 안의 일반 HTML 흐름이다. 절대 배치 편집기가 아니다. 그래서 Figma의 X/Y, Constraints, "Ignore auto layout"은 기본 숨김이고, 흐름 레이아웃 속성(margin, padding, gap, display)이 중심이다.

### 2.1 위치와 크기

| Figma | CSS | 제안 |
|---|---|---|
| 정렬 바(단일 선택, 부모 기준) | 부모가 flex면 `align-self`/`justify-self`/auto margin, 아니면 `margin-inline: auto`, `text-align` | 부모 display에 따라 동작을 바꾼다. 아래 2.1.1 |
| X, Y | `position` + `left/top` 또는 `translate` | `position`이 static이면 기본 숨기고, Position 섹션에서 "Position: Relative/Absolute" 선택 시에만 노출 |
| Rotation | `rotate: Ndeg` (개별 transform 속성) | `transform` 문자열을 건드리지 않으려 `rotate` 사용. Figma와 부호가 반대(CSS는 시계 방향 양수). UI는 CSS 기준 유지 |
| W, H | `width`, `height` | 값 단위 px 기본, `%`, `auto`, `vw` 선택 가능 |
| Fixed | `width: Npx` | |
| Hug contents | `width: fit-content` (또는 `auto`와 `flex: none`) | 인라인 흐름에서는 `auto`와 동일할 수 있음 |
| Fill container | 부모가 flex이고 주축이면 `flex: 1 1 0`, 교차축이면 `align-self: stretch`. 그 밖이면 `width: 100%` | 부모 display를 읽어 CSS를 고른다 |
| min/max | `min-width`, `max-width`, `min-height`, `max-height` | 미구현(보류: 사용 빈도가 낮고 레이아웃 칸이 늘어남). 지금은 W/H 옆 Width mode와 Height mode 세그먼트만 있다 |
| 비율 잠금 | 값을 쓰지 않고 입력만 묶는다(문서에 저장하지 않음) | 구현됨. W/H 옆 "Lock aspect ratio" 토글(편집기 세션 상태, 선택이 바뀌면 풀림). 잠그면 W나 H를 바꿀 때 잠글 때의 비율로 다른 축도 함께 바꾸고 실행 취소 한 건이다. 다중 선택에서는 꺼진다. 캔버스 모서리 리사이즈는 Shift로 비례 |
| Constraints | 해당 없음 | 숨김(절대 배치 편집기가 아님) |
| Ignore auto layout | `position: absolute` | 숨김. 필요하면 후속 |
| z-order | `z-index` (+ `position`이 static이면 효과 없음에 주의) | Position 섹션의 "Z" 필드(구현됨) |

#### 2.1.1 정렬 바 동작 (제안)

| 선택 요소의 부모 | Align left / center / right | Align top / middle / bottom |
|---|---|---|
| `display:flex` 가로 | `justify-self` 대신 자식에 `margin-left/right: auto` 조합 | `align-self: flex-start/center/flex-end` |
| `display:flex` 세로 | `align-self: flex-start/center/flex-end` | `margin-top/bottom: auto` 조합 |
| `display:grid` | `justify-self: start/center/end` | `align-self: start/center/end` |
| 그 밖(block) | `margin-inline: auto` 또는 `text-align`(텍스트면) | 비활성 |

### 2.2 레이아웃 (Auto layout 대응)

| Figma | CSS | 제안 |
|---|---|---|
| Frame / Auto layout 켜기 | `display: flex` | 섹션 이름은 "Layout". 토글 대신 display 7택(Block, Flex, Grid, Inline, Inline block, Inline flex, None)으로 노출 |
| 방향 Horizontal / Vertical | `flex-direction: row / column` | 아이콘 2개 세그먼트 |
| Wrap | `flex-wrap: wrap` | 아이콘 토글 |
| Grid | `display: grid` + `grid-template-columns` | 열 수만 구현됨: Display가 Grid일 때 "Columns" 숫자 한 칸(1~12)이 `repeat(N, 1fr)`로 쓴다. 트랙 크기와 행은 후속 |
| Spacing(gap) | `gap`, 필요 시 `row-gap`/`column-gap` | 필드 1개. 확장하면 둘로 분리 |
| Spacing Auto (Between/Around/Evenly) | `justify-content: space-between / space-around / space-evenly` | gap 필드 대신 "Auto" 선택 시 |
| Alignment 3x3 박스 | `justify-content` + `align-items` | 3x3 점 격자 하나로 두 속성 동시 설정. 방향에 따라 축이 바뀐다 |
| Padding | `padding` (묶음 또는 4변 개별) | 기본은 가로, 세로 2필드. 확장 토글로 4변 |
| Clip content | `overflow: hidden` | Switch(compact), 라벨 "Clip content" |
| Resizing 모드 | 2.1 참고 | W/H 필드 오른쪽에 모드 드롭다운 |

### 2.3 Margin, overflow (Figma에 없음, CSS 편집기라 추가)

| 항목 | CSS | 제안 |
|---|---|---|
| Margin | `margin` 묶음 또는 4변 | Layout 섹션에 Padding과 같은 형태로 나란히. 아이콘으로 구분 |
| Overflow | `overflow: visible / hidden / auto`, 필요 시 x, y 개별 | Clip content 체크박스는 hidden 전용 단축. 세 값은 "..." 확장 메뉴 |
| display | `block / flex / grid / none / inline-block` | none은 "Hidden" 토글(눈 아이콘)로 따로 노출 |
| justify / align (flex 아님일 때) | 숨김 | display가 flex나 grid일 때만 노출 |

### 2.4 외형, 텍스트, 색, 효과

| Figma | CSS | 제안 |
|---|---|---|
| Opacity | `opacity` (0 ~ 1) | UI는 % (0 ~ 100) |
| Blend mode | `mix-blend-mode` | 드롭다운(Normal, Multiply, Screen, Overlay, Darken, Lighten, Difference) |
| Corner radius | `border-radius` 묶음 또는 4모서리 개별(`border-top-left-radius` ...) | 확장 토글로 4개 |
| Font family | `font-family` | 덱에 쓰인 폰트 목록 Select |
| Weight | `font-weight` (300 ~ 800) | Select(Light, Regular, Medium, Semibold, Bold, Extra bold) |
| Size | `font-size` | px |
| Line height | `line-height` | 값이 숫자(배수)면 `1.4` 형태 유지, px면 px. 단위 토글 |
| Letter spacing | `letter-spacing` | Figma는 %, 우리는 `em`을 % 로 표기(1% = 0.01em) |
| 가로 정렬 | `text-align` left, center, right, justify | 아이콘 4개 세그먼트 |
| 세로 정렬 | flex 컨테이너면 `align-items`, 아니면 숨김 | Layout 정렬 박스가 대신함 |
| Decoration | `text-decoration-line` underline, line-through | 아이콘 토글 2개 |
| Case | `text-transform` none, uppercase, lowercase, capitalize | 아이콘 4개 세그먼트 (Figma의 Small caps는 `font-variant-caps: small-caps`, 후속) |
| Truncate | `text-overflow: ellipsis; white-space: nowrap; overflow: hidden`, 줄 수 제한은 `-webkit-line-clamp` | 후속 |
| Fill (Solid) | `background-color` (텍스트 요소의 글자색은 `color`) | 텍스트 요소에서는 "Text color"가 `color`. Fill은 `background-color` |
| Fill (Gradient) | `background-image: linear-gradient(...)` | 구현됨(요소 Fill의 Linear gradient, 슬라이드 Background, 스톱 2~4개) |
| Fill (Image) | `background-image: url()` + `background-size` | 후속 |
| Fill opacity | 색의 알파(`rgb(... / a)`) | 별도 `opacity`와 구분. 스와치 옆 % 필드는 알파 |
| Stroke | `border` (width, style, color) | 위치 Inside는 `box-sizing: border-box`, Outside는 `outline` 또는 `box-shadow 0 0 0 Npx`. 기본은 border만 |
| Stroke 변별 | `border-top` ... | 확장 토글 |
| Stroke 대시 | `border-style: dashed / dotted` | Style Select |
| Drop shadow | `box-shadow: x y blur spread color` (텍스트 요소는 `text-shadow`는 후속) | 목록 항목 최대 8개 |
| Inner shadow | `box-shadow: inset ...` | 같은 목록에서 Type으로 구분 |
| Layer blur | `filter: blur(Npx)` | 1개 |
| Background blur | `backdrop-filter: blur(Npx)` | 1개 |
| Export | 해당 없음 | 숨김(내보내기는 별도 기능) |

## 3. 속성별 아이콘 표

모든 이름은 `node_modules/lucide-react/dist/esm/icons/<이름>.mjs` 존재를 확인했다(2026-10-13, lucide-react ^1.56.0). 컴포넌트 이름은 PascalCase로 바꿔 쓴다(예: `move-horizontal` -> `MoveHorizontal`).

### 3.1 한 글자 라벨을 쓰는 속성

아이콘이 모호하거나 Figma가 글자를 쓰는 곳은 글자로 쓴다. 글자는 `text-muted-foreground`, 11px(compact `caption`), 가운데 정렬, 고정 너비 12px.

| 속성 | 라벨 | 이유 |
|---|---|---|
| left / top 위치 | X, Y | Figma와 같음 |
| width / height | W, H | Figma와 같음 |
| z-index | Z | 아이콘 모호 |
| 4변 개별 padding | T, R, B, L | 4칸이 각각 어느 변인지 글자가 가장 분명 |
| 4변 개별 margin | T, R, B, L | 같음 |
| 4모서리 radius | 글자 없이 모서리 모양 아이콘 4개가 어렵다. 라벨 없이 순서를 TL, TR, BR, BL로 고정하고 툴팁으로 설명 | lucide에 모서리별 아이콘 없음 |
| min / max | min, max (작은 글자) | 아이콘 없음 |

### 3.2 아이콘을 쓰는 속성

| 속성 | lucide 이름 | 비고 |
|---|---|---|
| 회전 | `rotate-cw` | 라벨 대신 아이콘 |
| Corner radius | `square-round-corner` | 묶음 필드의 앞 아이콘 |
| Opacity | `blend` | 투명 느낌. 대안 `droplet` |
| Blend mode | `layers` | 대안 `layers-2` |
| Padding (묶음) | `box-select` | 안쪽 여백. 대안 `scan` |
| Padding 가로 | `align-horizontal-space-around` | 가로 안쪽 여백으로 쓰기엔 의미가 약함. 대안 `move-horizontal` |
| Padding 세로 | `align-vertical-space-around` | 대안 `move-vertical` |
| Margin (묶음) | `square-dashed` | 바깥 여백 |
| Gap | `between-horizontal-start` (가로), `between-vertical-start` (세로) | 방향에 따라 바꾼다 |
| 가로 gap / 세로 gap | `unfold-horizontal`, `unfold-vertical` | 행/열 gap 분리 시 |
| 방향 가로 | `arrow-right` | 세그먼트 |
| 방향 세로 | `arrow-down` | 세그먼트 |
| Wrap | `wrap-text` | lucide에 `wrap`은 없음 |
| Grid | `layout-grid` | display 선택지 |
| 정렬 바 (좌, 가운데, 우) | `align-start-vertical`, `align-center-vertical`, `align-end-vertical` | 이름의 vertical은 세로 선 기준이라 가로 정렬에 해당 |
| 정렬 바 (상, 중간, 하) | `align-start-horizontal`, `align-center-horizontal`, `align-end-horizontal` | 가로 선 기준 |
| justify-content | `align-horizontal-justify-start`, `-center`, `-end`, `align-horizontal-space-around` | 정렬 3x3 박스를 못 만들 때의 대체 |
| 세로 분배 | `align-vertical-justify-start`, `-center`, `-end` | |
| 텍스트 정렬 | `text-align-start`, `text-align-center`, `text-align-end`, `text-align-justify` | 대안 `align-left` 계열도 있음 |
| Bold, Italic | `bold`, `italic` | weight Select가 있으면 불필요 |
| Underline | `underline` | |
| Strikethrough | `strikethrough` | |
| Case none | `case-sensitive` | |
| Case upper | `case-upper` | |
| Case lower | `case-lower` | |
| Case capitalize | `a-large-small` | 확실한 아이콘 없음, 툴팁 필수 |
| Font size | `a-arrow-up` | 또는 글자 "Aa" |
| Line height | `list-collapse` | 대안 `between-vertical-start`. 전용 `line-height` 아이콘 없음 |
| Letter spacing | `space` | 또는 `move-horizontal`. 혼용 금지 |
| Font family | `type` | |
| Text color | `baseline` | 글자색 표시용 |
| Fill 보이기 | `eye`, `eye-off` | 행 끝 토글 |
| 추가, 제거 | `plus`, `minus` | 섹션 헤더, 항목 행 |
| 접기 | `chevron-down`, `chevron-right` | |
| 비율 잠금 | `link`, `unlink` | 대안 `lock`, `lock-open` |
| Clip content | `scan-line` | 체크박스 라벨로 쓰므로 아이콘 불필요 |
| Overflow | `fullscreen` | 후속 |
| Shadow 항목 | `layers` | 목록 앞에는 아이콘 없이 요약 텍스트 |
| Blur | `droplets` | |
| 효과 설정 | `sliders-horizontal` | 항목별 팝오버 |
| 더보기 | `ellipsis` | |
| 색 뽑기(스포이드) | `pipette` | 구현됨(색상 선택기의 스포이드) |
| 크기 모드 Fixed | `square` | W/H 모드 드롭다운 옵션 |
| 크기 모드 Hug | `shrink` | |
| 크기 모드 Fill | `expand` | |
| 슬라이드 종류 | `frame` | 슬라이드 선택 시 |
| 숨김(display:none) | `eye-closed` | |

없는 이름: `wrap`. 대체 `wrap-text`. `line-height`, `radius` 계열은 일부 존재하지만 의미가 약해 위 표에서는 쓰지 않았다.

## 4. 인스펙터 레이아웃 제안

### 4.1 공통 규칙

| 항목 | 규칙 |
|---|---|
| 패널 폭 | 현재 우측 패널 폭 유지. 한 행 안에 필드 2개가 들어가야 하므로 최소 240px 이상 확보 |
| 크기 | `SizeProvider` compact(28px 행). 밀도가 필요한 쌍(X/Y, W/H)은 24px 행을 허용하지만 한 패널에서 두 높이를 섞지 않는다. 24px를 쓰려면 섹션 전체를 24px로 통일 |
| 행 | 라벨 열 없이 필드 자체에 앞 라벨 또는 아이콘을 넣는다(Figma 방식). 현재 `Row`의 56px 라벨 열 구조는 버린다 |
| 그리드 | `grid-template-columns: 1fr 1fr`, 가로 gap 8px, 세로 gap 8px. 한 필드만 있는 행은 2열 병합 |
| 섹션 | 헤더 28px: 제목(caption, semibold), 오른쪽에 +/- 또는 보조 컨트롤. 접지 않는다. 섹션 사이 구분선 1px(`bg-border/60`), 섹션 패딩 16px |
| 호버 | 항목 행의 제거(-) 버튼과 섹션 보조 버튼은 호버 또는 포커스 때만 보인다. 터치 기기는 항상 보인다 |
| 접기 상태 | 접기 기능이 없어 상태를 저장하지 않는다 |
| Mixed | 다중 선택(같은 부모의 요소 묶음)에서 값이 요소마다 다를 때와, 한 요소 안에서 값이 일관되지 않을 때(예: 모서리 4개가 다름) "Mixed" 플레이스홀더를 쓴다 |
| 변경 기록 | 한 번의 스크럽 드래그는 편집 기록(undo) 1건. `NumberField`의 `onScrubStart`/`onScrubEnd`로 스크럽 한 번을 undo 1건으로 묶는다(구현됨) |

### 4.2 섹션 순서 (요소 선택)

위에서 아래로. 컨테이너와 텍스트의 차이는 4.5에서 설명한다.

| 순서 | 섹션 | 텍스트 | 컨테이너 | 내용 |
|---|---|---|---|---|
| 1 | Align | 노출 | 노출 | 정렬 바 6개 아이콘 |
| 2 | Layout | 일부 | 전체 | display, W/H, 모드, 방향, 정렬, gap, padding, margin, Clip |
| 3 | Position | 조건부 | 조건부 | Offset X/Y(`translate`), Position Select, 회전, Z는 항상. X/Y(`left`, `top`)는 position이 static이 아닐 때만 |
| 4 | Appearance | 노출 | 노출 | Opacity, Radius, Blend, 단계 등장 편집(Appears at step, Step effect 6종: Rise, Fade, Slide, Scale, Blur, None, 미리보기 버튼) |
| 5 | Typography | 노출 | 숨김 | 4.4 참고 |
| 6 | Fill | 노출 | 노출 | background-color 목록(최대 1) |
| 7 | Stroke | 노출 | 노출 | border |
| 8 | Effects | 노출 | 노출 | shadow, blur |

Figma는 Position이 맨 위지만, 우리는 흐름 레이아웃이 중심이라 Layout을 앞에 둔다(제안). 사용 빈도가 높은 크기와 간격이 위에 온다.

### 4.3 행 배치 (영어 UI 문구 예시)

| 섹션 | 행 | 왼쪽 필드 | 오른쪽 필드 |
|---|---|---|---|
| Align | 1 | 정렬 6버튼 한 줄 (여섯 칸 균등) | |
| Layout | 1 | Display Select ("Block", "Flex", "Grid", "Inline", "Inline block", "Inline flex", "None") 전체 폭 | |
| Layout | 2 | W 필드 + 모드 드롭다운("Fixed", "Hug", "Fill") | H 필드 + 모드 드롭다운 |
| Layout | 3 (flex) | 방향 세그먼트 (Row, Column 아이콘) + Wrap 토글 | 정렬 3x3 박스 |
| Layout | 4 (flex, grid) | Gap 필드 (아이콘 `between-*`) | |
| Layout | 5 | Padding: H 필드, V 필드 + 확장 토글(`ellipsis` 또는 `chevron`) | |
| Layout | 5 확장 | T, R | B, L |
| Layout | 6 | Margin: 같은 구조 | |
| Layout | 7 | "Clip content" 체크박스 | |
| Position | 1 | X | Y |
| Position | 2 | 회전(`rotate-cw`) | Z |
| Appearance | 1 | Opacity (`blend`, %) | Radius (`square-round-corner`) |
| Appearance | 1 확장 | Radius 4개 (TL, TR / BL, BR) | |
| Appearance | 2 | Blend Select ("Normal", "Multiply", "Screen", "Overlay", "Darken", "Lighten", "Difference") | |
| Typography | 1 | Font family Select 전체 폭 | |
| Typography | 2 | Weight Select | Size 필드 |
| Typography | 3 | Line height 필드 | Letter spacing 필드 |
| Typography | 4 | 텍스트 정렬 세그먼트(4) | 장식 토글(2) |
| Typography | 5 | 대소문자 세그먼트(4) | |
| Fill | 목록 | [스와치] [hex] [알파 %] [눈] [-] | |
| Stroke | 1 | [스와치] [hex] [알파 %] [눈] [-] | |
| Stroke | 2 | Width 필드 | Style Select ("Solid", "Dashed", "Dotted") |
| Stroke | 3 | Sides 확장 (T, R, B, L) | |
| Effects | 목록 | 효과 요약 한 줄 + `sliders-horizontal` + `-` | |

섹션 헤더 문구(영어): "Align", "Layout", "Position", "Appearance", "Typography", "Fill", "Stroke", "Effects". 섹션 +를 누르면 기본값 추가: Fill `#FFFFFF`, Stroke `1px solid #000000`, Effects `Drop shadow 0 4 8 0 rgba(0,0,0,.25)`.

### 4.4 숫자 입력 규칙 (NumberField)

| 항목 | 규칙 |
|---|---|
| 단위 | px 기본. 입력에 `%`, `em`, `rem`, `vw`, `auto`를 붙이면 그대로 기록. 단위 없는 숫자는 px(단, `line-height`는 배수 유지, `opacity`는 %) |
| 앞 라벨 | 필드 안쪽 왼쪽에 한 글자 또는 아이콘. 라벨 영역이 스크럽 핸들 |
| 스크럽 | 라벨 영역 포인터 다운 후 가로 드래그. 1px 이동당 `step`. 커서 `ew-resize`. 포인터 캡처로 필드 밖으로 나가도 계속. 화면 위쪽으로 가면 빠르게, 아래쪽이면 느리게(Figma 2x, 1/2, 1/4를 따른다) |
| 화살표 | 포커스 상태에서 위, 아래 키는 `step`(기본 1), Shift는 10배(10). Alt는 0.1배(소수 허용 필드만) |
| 수식 | `+10`, `*2`, `/4`로 현재 값 기준 계산. 파서는 사칙연산만(괄호 포함은 후속). 평가는 `eval` 금지, 직접 토큰 파싱 |
| 확정 | Enter 또는 blur에 커밋. Esc로 취소하고 원래 값 복원 |
| 빈 값 | 지우고 확정하면 속성 제거(인라인 style 삭제) 또는 `auto`. Select로 의도를 분리: 값 없음은 "Auto" 플레이스홀더로 표시 |
| 최소, 최대 | `min`, `max` 클램프(예: opacity 0 ~ 100, font-size 1 ~ 400) |
| 상속값 | 인라인 style이 없고 계산된 값만 있을 때는 값을 흐린 색(`text-muted-foreground`)으로 표시. 편집하면 인라인으로 기록 |
| Mixed | 값을 못 정하면 플레이스홀더 "Mixed". 스크럽이나 화살표로 첫 변경 시 모두 같은 값으로 맞춘다 |
| 폭 | `tabular-nums`(기존 `Field`가 이미 적용) |

### 4.5 색 입력 (ColorField)

| 항목 | 규칙 |
|---|---|
| 구성 | `[스와치 20x20] [hex 필드] [알파 % 필드]` 한 행. 스와치 클릭 시 팝오버 색 선택기(Saturation/Hue/Alpha) |
| 스와치 | 격자 배경(투명 표시) 위에 색 채움. 모서리 `rounded-md`(shape 토큰) |
| hex | `#RRGGBB` 또는 `#RRGGBBAA`. 3자리는 확장. 잘못된 입력은 blur 때 원래 값 복원 |
| 알파 | 0 ~ 100 %. 값이 바뀌면 `rgb(r g b / a)` 로 기록 |
| 기본 선택기 | 스와치를 누르면 Fluid `ColorPickerPopover`(`ui/color-picker.tsx`, 처음 열 때 지연 로드)가 열린다. 알파는 hex 옆 % 필드로도 고친다 |
| 토큰 | 덱에 쓰인 CSS 변수(`var(--...)`)는 값 대신 이름 칩으로 표시, 칩을 지우면 고정 값으로 풀림(후속) |

### 4.6 4변 padding, margin 확장 토글

| 상태 | 표시 |
|---|---|
| 접힘(기본) | 한 행에 H, V 두 필드. 4변이 모두 같으면 하나만 보이는 단일 필드 모드는 쓰지 않는다(혼란 방지) |
| 펼침 | H/V 행이 T/R 행과 B/L 행으로 바뀐다. 토글은 같은 자리 아이콘 버튼(`chevron-down` / `chevron-right`) |
| 값 기록 | 접힘에서 H를 고치면 `padding-left`와 `padding-right`를 함께 쓴다. 한 변이라도 다르면 접힘 상태에서 H에 "Mixed" |
| 규칙 | 4변 모두 같으면 `padding: Npx` 한 줄로 기록, 다르면 개별 속성. 읽을 때는 계산된 값에서 가져온다 |

### 4.7 요소 종류별 차이

| 상황 | 보이는 섹션 | 숨김 | 비고 |
|---|---|---|---|
| 텍스트 요소 (`textual(el)`이 참, 자식이 텍스트뿐) | Align, Layout(W/H, margin, 일부), Appearance, Typography, Fill, Stroke, Effects | Layout의 방향, gap, 정렬 3x3, padding(텍스트면 padding은 유지) | Typography가 맨 위 가까이(Align 다음)로 올라와도 된다. 텍스트 편집이 주 작업이라서(제안) |
| 컨테이너 (자식 요소가 있음) | Align, Layout 전체, Position, Appearance, Fill, Stroke, Effects | Typography(단, 글자색 상속을 바꾸는 "Text color"만 Fill 안에 별도 행) | 컨테이너의 `color`는 하위 텍스트에 상속되므로 "Text color" 한 행만 둔다 |
| 이미지, SVG (`img`, `svg`) | Align, Layout(W/H, 비율 잠금, margin), Appearance, Stroke, Effects | Typography, Fill | Appearance 뒤에 `Image` 섹션(Replace image..., Fit, Position) |
| 슬라이드 선택 (요소 미선택) | 아래 4.8 | | |

### 4.8 슬라이드 선택 시 (요소 미선택)

현재 구현의 "종류", "장 제목"을 Figma의 "아무것도 선택하지 않았을 때"(캔버스 배경, 페이지 전체 내보내기) 규칙에 맞춰 옮긴다.

| 행 | 컨트롤 | CSS 또는 속성 | 영어 문구 |
|---|---|---|---|
| 종류 | Select (Cover, Chapter, Content, End) | `data-slide` | "Type" |
| 레이아웃 | Select (content 슬라이드만) | `data-layout` | "Layout" |
| 장 제목 | Field | `data-title` | "Chapter title" |
| 배경 | Solid / Linear gradient 세그먼트, ColorField 또는 그라디언트 편집기 | 슬라이드 루트 `background-color` 또는 `background-image` | "Background" (별도 섹션) |
| 스텝 수 | `NumberField`(Frame 아이콘, min 1) | 슬라이드 루트 `data-steps`(1이면 속성 삭제) | "Steps" |

스텝 수는 SPEC.md 2절과 6.3절의 `data-steps="N"`을 따른다.

## 5. 구현 제약

### 5.1 쓰는 것

UI는 Fluid Functionalism 컴포넌트와 `app/src/components/ui/field.tsx` 입력창만 쓴다. 직접 만든 `div` 스타일 컨트롤은 두지 않는다. 크기는 `SizeProvider`의 compact(28px)를 기본으로 하고, 필요한 행만 24px를 쓴다.

### 5.2 이미 있는 것

| 컴포넌트 | 파일 | 인스펙터에서의 쓰임 |
|---|---|---|
| `Tabs`, `TabsList`, `TabItem`, `TabPanel` | `ui/tabs.tsx` | 상단 "Design" / "Comments" 탭 (현재 사용 중) |
| `TabsSubtle`, `TabsSubtleItem` | `ui/tabs-subtle.tsx` | 세그먼트 컨트롤의 토대 후보(방향, 정렬, 대소문자). 그대로는 탭 의미라 접근성 역할(radiogroup)을 따로 맞춰야 한다 |
| `Select`, `SelectTrigger`, `SelectContent`, `SelectItem` | `ui/select.tsx` | Display, Blend, Font family, Weight, Stroke style, Type (현재 사용 중, `size="compact"`) |
| `Button` | `ui/button.tsx` | 아이콘 버튼(+, -, 토글). `variant`와 `size="compact"` |
| `Switch` | `ui/switch.tsx` | Clip content 등 on/off |
| `Tooltip` | `ui/tooltip.tsx` | 모든 아이콘 전용 컨트롤에 필수 |
| `Dropdown`, `MenuItem`, `DropdownSub` | `ui/dropdown*.tsx`, `menu-item.tsx` | 섹션 "..." 메뉴, 효과 종류 선택 |
| `Field`, `TextArea` | `ui/field.tsx` | 숫자와 문자 입력의 바탕. 앞 라벨 슬롯이 없다 |
| `ScrollArea` | `ui/scroll-area.tsx` | 패널 스크롤 |
| `Card`, `Dialog`, `CommandMenu` | `ui/` | 인스펙터에서는 쓰지 않음 |
| 토큰 | `index.css`, `lib/size-context.tsx`, `lib/shape-context.tsx`, `lib/springs.ts`, `lib/type-scale.ts` | 크기 사다리(default 36, compact 28), 표면(`bg-hover`, `surface-*`), 모서리(`shape.input`), 스프링(`fast` 0.08s, `moderate` 0.16s, `slow` 0.24s), 타입(`caption` 11px compact, `body` 12px compact) |

### 5.3 구현 상태 (아래 컴포넌트는 모두 `app/src/components/ui/`에 구현됨, `IconToggle`은 만들지 않고 `Button` + `aria-pressed`로 처리)

| 컴포넌트 | 역할 | 비고 |
|---|---|---|
| `NumberField` | 앞 라벨(글자 또는 아이콘) + 스크럽 + 화살표, Shift 10배 + 수식 + 단위 + Mixed | `Field` 위에 얹는다. 라벨 영역이 스크럽 핸들. 4.4 규칙 전부 |
| `ColorField` | 스와치 + hex + 알파 | 4.5. 팝오버는 Fluid `Dropdown`/popup 토큰 재사용 |
| `SegmentedControl` | 아이콘 2 ~ 4개 중 하나 선택(방향, 정렬, 대소문자) | `TabsSubtle` 위에 `role="radiogroup"` 래퍼로 구현하거나 합성. 선택 표면 이동은 `spring.moderate` |
| `IconToggle` | on/off 아이콘 버튼(밑줄, 취소선, Wrap, 눈, 비율 잠금) | `Button`의 `variant` 하나로 가능하면 새 컴포넌트 없이 `Button` + `aria-pressed`로 처리. 먼저 `Button`으로 시도 |
| `InspectorSection` | 헤더(제목 + 우측 슬롯) | 접지 않는다 |
| `AlignBox` | 3x3 점 격자 정렬 박스 | `justify-content` + `align-items` 쌍 |
| `SidesField` | 4변 확장 필드(padding, margin, radius, border-width 공용) | T/R/B/L 라벨, 접힘 H/V |
| `ShadowItem` | 효과 한 줄 + 설정 팝오버 | 후속 단계로 미뤄도 된다 |

### 5.4 새 컴포넌트가 따라야 하는 Fluid 규칙

| 규칙 | 내용 |
|---|---|
| 크기 | 높이는 `useSize().control`(compact `h-7`, 28px). 24px 행이 필요하면 `size.control` 대신 명시적 `h-6`을 그 섹션에서만 쓰고, 안쪽 패딩과 글자는 compact 토큰을 그대로 쓴다 |
| 글자 | `useSize().text`, `useSize().field`(입력). 임의 `text-[12px]` 금지 |
| 패딩, 간격 | `size.px`, `size.itemPx`, `size.gap`. 아이콘 크기는 `size.icon`(compact 14px) |
| 표면 | 입력 바탕은 `bg-hover`, 포커스는 `focus-visible:ring-2 focus-visible:ring-focus-ring`(기존 `Field`와 동일). 새 색 하드코딩 금지 |
| 모서리 | `useShape()`의 토큰 |
| 모션 | `lib/springs.ts`의 `spring.fast/moderate/slow`만. 수치 직접 지정 금지. 스크럽 중 값 변화는 애니메이션 없음 |
| 접근성 | 아이콘 전용 컨트롤은 `aria-label`과 `Tooltip`. 세그먼트는 `radiogroup`, 토글은 `aria-pressed`. 스크럽 핸들에도 키보드 대체(화살표)가 있어야 한다 |
| 감소된 모션 | `prefers-reduced-motion`이면 스프링 대신 즉시 전환(기존 컴포넌트 처리 방식 확인 후 따를 것, 이 문서에서는 미확인) |
| 파일 위치 | `app/src/components/ui/`에 두고 기존 파일처럼 `"use client"` 헤더와 export 방식을 따른다 |

### 5.5 데이터 흐름 (현재 구조에서 바뀌는 점)

| 항목 | 현재 | 변경 제안 |
|---|---|---|
| 값 읽기 | `useEffect`에서 `getComputedStyle`로 4개(size, weight, align, color)만 읽어 state | 속성 수가 많아지므로 섹션별로 `useComputed(el, selId, props[])` 훅 하나로 필요한 속성만 읽는다 |
| 값 쓰기 | `onStyle(prop, value)` | 유지. 숫자 필드는 단위 포함 문자열을 넘긴다 |
| 재읽기 | `selId` 변화 시 | 유지. 스크럽 중 외부 변경이 없으므로 충분 |
| 상속값 구분 | 없음 | `el.style.getPropertyValue(prop)`가 비어 있으면 "상속 또는 기본" 표시 |

## 6. UI 문구 (영어, 다국어 없음)

| 위치 | 문구 |
|---|---|
| 탭 | "Design", "Comments" |
| 빈 코멘트 | "Select an element and leave a comment" |
| 섹션 | Align, Layout, Position, Appearance, Typography, Fill, Stroke, Effects |
| 크기 모드 | aria-label "Width mode", "Height mode", 항목 "Fixed width", "Fixed height", "Hug contents", "Fill container" |
| display | aria-label "Display", 항목 "Block", "Flex", "Grid", "Inline", "Inline block", "Inline flex", "None" |
| 방향, 줄바꿈 | "Direction", 항목 "Row", "Column", 토글 "Wrap" |
| 간격 | "Gap" |
| 정렬 | "Align left", "Align horizontal center", "Align right", "Align top", "Align vertical center", "Align bottom" (Align 섹션) |
| padding, margin | 그룹 "Padding", "Margin". 칸은 "Padding horizontal", "Padding vertical", 펼치면 "Padding top", "Padding right", "Padding bottom", "Padding left", 토글 "Padding show each side" 또는 "Padding combine sides" (Margin도 같은 형식) |
| radius | "Corner radius", 토글 "Individual corners", 모서리는 "Top left radius", "Top right radius", "Bottom right radius", "Bottom left radius" |
| 위치 | "Position", "Offset X", "Offset Y", "Rotation", "Z-index", 종류 "Static", "Relative", "Absolute" |
| 외형 | "Opacity", "Blend mode", "Clip content" |
| 텍스트 | "Font", "Weight", "Font size", "Line height", "Letter spacing", "Text align"(항목 "Text align left", "Text align center", "Text align right", "Justify text"), "Text case"(항목 "No case change", "Uppercase", "Lowercase", "Capitalize"), "Underline", "Strikethrough", "Text color", "Text style" |
| Fill | "Fill", "Fill type"(항목 "Solid", "Linear gradient", "Image"), "Fill gradient", "Add fill", "Remove fill" |
| Stroke | "Stroke color", "Stroke width", "Stroke style"(항목 "Solid", "Dashed", "Dotted"), "Add stroke", "Remove stroke" |
| Effects | "Add effect", 항목 "Drop shadow", "Inner shadow", "Layer blur", "Background blur". 그림자 칸은 "Shadow 1 X", "Shadow 1 Y", "Shadow 1 blur", "Shadow 1 spread", "Shadow 1 color", "Remove shadow 1", 블러는 "Remove layer blur", "Remove background blur" |
| 이미지 | "Image fit"(항목 "Cover", "Contain" 등), "Image position", "Choose image file", "Replace image..." |
| 슬라이드 | "Type", "Chapter title", "Background", "Background type", "Background gradient", "Steps", "Appears at step", "Step effect", "Preview step effect" |
| 레이어 | "Show in layers" |
| 값 | "Mixed", "Auto" |
| 슬라이드 | "Type", "Chapter title", "Background", "Steps" |

문구 규칙: em-dash, en-dash, 가운뎃점, 이모지를 쓰지 않는다. 문장 끝에 마침표를 찍지 않는 짧은 라벨 형식을 유지한다.

## 7. 단계 제안 (구현자 참고)

| 단계 | 범위 | 이유 |
|---|---|---|
| 1 | `NumberField`, `InspectorSection`, `SegmentedControl`, `ColorField` | 나머지 섹션이 모두 의존 |
| 2 | Layout(display, W/H, 모드, padding, margin, gap, 방향) + Appearance(opacity, radius) | 슬라이드 편집에서 가장 자주 쓰는 속성 |
| 3 | Typography 확장(family, line height, letter spacing, decoration, case) | 현재 4개에서 확장 |
| 4 | Fill, Stroke, Effects | 목록형 UI |
| 5 | 정렬 바, AlignBox, Position(X/Y/Z, 회전) | 부모 display 분기가 복잡해서 뒤로 |
| 6 | 슬라이드 선택 화면(배경, 스텝 수) | 데이터 구조 확인 필요 |

## 8. 미확인 목록

| 항목 | 상태 |
|---|---|
| Figma UI3의 정확한 섹션 배치(Appearance 안에 무엇이 들어가는지) | 공식 문서가 일반 섹션 목록만 제공 |
| 행 높이, 열 폭, 라벨 폭의 정확한 픽셀 | 공식 문서에 없음 |
| 필드 안 화살표 키의 정확한 증감 단위 | 캔버스 넛지만 확인(1, Shift 10) |
| 호버 때만 보이는 컨트롤의 정확한 목록 | 공식 문서에 없음 |
| Clip content의 공식 설명 | F3에 없음 |
| Stroke의 위치, 두께, 변별, 대시 상세 | F7에 없음 |
| Corner radius의 정확한 UI3 위치 | 검색 요약만 |
| 슬라이드 노트 데이터 구조 | 저장소 SPEC.md 확인 필요 |
| `prefers-reduced-motion` 처리 방식 | Fluid 컴포넌트 내부 확인 필요 |
