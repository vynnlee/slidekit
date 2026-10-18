# 코멘트 기능 벤치 조사 (Figma, Claude Artifacts, 보조)

조사일 2026-10-18. WebSearch와 WebFetch만 사용. 공식 문서에서 확인한 것만 적고, 못 찾은 것은 "확인 못 함". 인용은 원문 그대로(영어).
출처 약칭: F1=https://help.figma.com/hc/en-us/articles/360039825314 (Guide to comments), F2=https://help.figma.com/hc/en-us/articles/360041547593 (View and manage comments), F3=https://help.figma.com/hc/en-us/articles/360041068574 (Comment on Figma Design files), F4=https://help.figma.com/hc/en-us/articles/360041547853 (Edit comments), F5=https://help.figma.com/hc/en-us/articles/360041547813 (알림 설정), F6=https://help.figma.com/hc/en-us/articles/360039824594 (프로토타입 코멘트)

## 1. Figma (Design, FigJam, 프로토타입)

| 항목 | 동작 설명 | 출처 |
|---|---|---|
| 접근 권한 | "can view" 이상이면 누구나 코멘트를 쓰고 본다. 모든 플랜. | F1, F3 |
| 코멘트 모드 | 툴바의 코멘트 도구 또는 `C`. 코멘트 모드에서는 캔버스 객체를 편집할 수 없고 `Esc`나 다른 도구를 고르면 편집으로 돌아간다. | F1, F2 |
| 캔버스 코멘트 표시 | 코멘트 모드 밖에서도 기본으로 캔버스에 보인다. `Shift + C`로 캔버스 표시를 켜고 끈다. | F2 |
| 핀 만들기 | 캔버스를 클릭하면 핀, 드래그하면 영역 선택. | F3 |
| 앵커 대상 | 최상위 frame, component, group 안에 핀을 꽂거나 영역을 잡으면 그 대상에 붙고, 대상을 옮기면 코멘트도 같이 움직인다. 중첩 frame, component, group, 다른 layer에는 붙지 않는다. | F3 |
| 핀과 스레드 팝오버 | 핀에 올리면 미리보기, 클릭하면 코멘트 모달이 열린다. 축소하면 가까운 코멘트가 묶여 개수와 작성자 아바타를 보여 주는 클러스터가 된다. | F2 |
| 작성 | 입력 후 전송 버튼. 작성 규모 제한: 모든 파일을 합쳐 시간당 100개(답글 포함). | F3 |
| 답글 | 코멘트 선택, **Reply** 클릭, 입력 후 `Enter`/`Return`. 답글도 이모지, 멘션, 미디어를 지원한다. Slack이나 Microsoft Teams 알림에서도 답글 가능. | F2, F3 |
| @멘션 | `@` 후 이름, 이메일, 사용자 그룹 이름 입력. 파란색으로 표시. 멘션된 사람은 코멘트와 디자인 미리보기가 든 이메일과 (켜 둔 경우) 인앱 알림을 받는다. 멘션 가능 범위는 권한과 플랜에 따라 다르다. 파일에 없는 사람은 먼저 초대해야 한다. | F3 |
| 이모지 | 스마일 아이콘에서 "Frequently used"와 검색. Apple 이모지 세트. 코멘트에 반응(reaction)도 단다. 코멘트 본문에 올려 반응 버튼을 누른다. | F3, F2 |
| 이미지 첨부 | 코멘트나 답글당 PNG, JPEG, GIF 최대 5개. 드래그, 붙여넣기, 이미지 아이콘. | F3 |
| 텍스트 서식 | 굵게 Cmd/Ctrl+B, 기울임 +I, 취소선 +Shift+X, 링크 +K, 번호 목록 +Shift+7, 글머리 +Shift+8. | F3 |
| 사이드 패널 목록 | 툴바 코멘트 아이콘 또는 `C`로 오른쪽 사이드바를 연다. 보기, 검색, 정렬, 필터. 각 코멘트에 소속 페이지가 표시되고 클릭하면 캔버스에서 열리며 그 페이지로 이동한다. (사이드바 도킹 방식은 문서에 없음: 확인 못 함) | F2 |
| 정렬 | 필터 드롭다운에서 **Date**(기본)와 **Unread**(안 읽은 것을 앞에). | F2 |
| 필터 | **Only your threads**(내가 멘션된, 내가 답한, 내 코멘트에 답이 달린 스레드), **Show resolved comments**, 현재 페이지만 보기(이미지 대체 텍스트에만 이름이 있음). | F2 |
| 읽음 표시 | 코멘트 모달에 "Mark as unread"와 "Copy link"가 있고 정렬에 "Unread"가 있다. 읽지 않음을 보여 주는 시각 표시의 모양은 문서에 없음: 확인 못 함. | F2 |
| 해결 | 코멘트 오른쪽 위의 resolve 컨트롤로 "Resolved" 처리. 캔버스와 사이드바에서 숨겨진다. | F2 |
| 다시 열기 | 코멘트에서 해결 상태 해제, 또는 사이드바에서 **Show resolved comments**를 켠 뒤 unresolve. | F2 |
| 프로토타입에서의 해결 | **Resolve** 선택하면 "Show resolved comments"(Options)를 켜기 전까지 프로토타입에서 숨겨진다. 옵션으로 "Show only your comments"도 있다. | F6 |
| 수정 | 본인이 쓴 코멘트만 수정. 메뉴에서 Edit, **Save**를 눌러야 반영, 저장 없이 나가면 버려진다. | F4 |
| 핀 이동 | 코멘트를 선택하고 핀을 드래그해서 새 위치에 놓는다. | F4 |
| 삭제 | 본인 코멘트만 삭제. 단일은 "Delete comment", 스레드는 "Delete thread" 후 확인 "Delete"(첫 코멘트와 모든 답글 삭제). 영구 삭제이고 이전 파일 버전을 복원해도 돌아오지 않는다. | F2 |
| 앵커 동작: 잘라내기/붙여넣기 | layer나 frame을 잘라내 붙여넣으면 코멘트가 그 layer에서 분리되고 사이드바에서는 계속 볼 수 있다. 파일 사이로 잘라 붙여도 코멘트는 안 따라가고 원래 파일에 분리된 코멘트로 남는다. | F4 |
| 앵커 동작: Move to page | layer의 코멘트도 같이 옮겨진다. layer나 frame이 아니라 캔버스에 연결된 코멘트는 안 옮겨진다. | F4 |
| 앵커 동작: 파일 복제 | 복제한 파일에는 코멘트가 복사되지 않는다. | F4 |
| 앵커 동작: frame 삭제 | 문서에 없음: 확인 못 함. | F1, F2, F4 |
| 키보드 | `C`(코멘트 모드와 패널), `Shift+C`(표시 토글), `Esc`(나가기), 작성창에서 `Enter` 전송, 서식 단축키. 코멘트 사이 이동 키는 문서에서 확인 못 함. | F2, F3 |
| 이메일 알림 | 파일 소유자는 기본으로 모든 코멘트 메일을 받는다. 코멘트 2개 이상 남긴 비소유자는 그 파일의 새 코멘트를 모두 받는다. 사이드바 **Settings**에서 **Everything** / **Just mentions and replies** / **Nothing**(Nothing이어도 @멘션 메일은 옴). | F5 |
| 인앱 알림 | 항상 받으며 끌 수 없다. | F5 |
| Slack 연동 | 연동하면 내가 참여한 파일이나 스레드에 코멘트가 달릴 때 Slack 알림. Email의 "View comment" 링크는 캔버스 코멘트면 캔버스 보기, 프로토타입 코멘트면 발표 보기로 연다. | F5, F2 |
| 여러 코멘트 일괄 처리 | 문서에서 확인 못 함(일괄 해결, 일괄 삭제 설명 없음). | F2 |
| 프로토타입 | 발표 보기에서 `C`로 코멘트. 툴바와 푸터를 숨기면 코멘트가 표시되지 않는다. 코멘트는 원본 디자인 파일에도 보인다. 로그인과 view 이상 권한이 필요. | F6 |

### Figma Slides

| 항목 | 동작 설명 | 출처 |
|---|---|---|
| 슬라이드 코멘트 | Slides 전용 코멘트 문서는 찾지 못했다(`.../360041546174`는 404). 코멘트 기능 일반은 Slides 헬프 페이지에서 "edit 또는 view 권한이 있으면 발표와 코멘트 같은 멀티플레이어 기능을 쓴다"는 취지만 확인(검색 요약). | https://help.figma.com/hc/articles/24170630629911 (원문 직접 확인은 못 함) |
| 발표 모드에서 코멘트 | 확인 못 함. 비공식 포럼 글에 "발표 중 C로 코멘트 모드를 켜서 발표자 노트를 계속 보이게 한다"는 사용자 팁이 있음(공식 아님). | https://forum.figma.com/t/bug-figma-slides-blocks-actions-with-comment-view/86725 및 검색 요약 |
| 프로토타입(발표 보기) 규칙 | Slides도 이 규칙을 따르는지 확인 못 함. | F6 |

## 2. Claude Artifacts와 Claude Code Artifacts

공식 출처: CC=https://code.claude.com/docs/en/artifacts, SH=https://support.claude.com/en/articles/9547008 (공유), KB=https://support.claude.com/en/articles/17457950 (키보드/스크린리더, 덱과 디자인 코멘트), DOC=https://support.claude.com/en/articles/16923645-get-started-with-claude-docs

| 항목 | 동작 설명(원문 인용) | 출처 |
|---|---|---|
| 조직 내 코멘트 | "When you share an artifact within your organization, the people you share it with can leave comments on the page, and you can have Claude read those comments and reply to them." Claude Code v2.1.221 이상 필요. | CC |
| 공개 링크와 코멘트 | "If you share an artifact publicly, people whose only access is the public link don't see its comments and can't add any. Existing comment threads stay on the artifact, and you and its editors can still read and reply to them." | CC |
| 스레드를 Claude에게 보내기 | "Someone who can edit the artifact sends a comment to Claude: in a thread on the page, they send a comment with **Send to Claude**, or mention `@claude` in one. Either way, they activate the thread." | CC |
| 활성화(activated) 스레드 | "Claude can reply to or resolve only an activated thread. Other threads stay open until a person resolves them on the page." Claude의 답글은 "Viewers see each reply attributed to Claude, via you." | CC |
| 읽기 요청 | Claude에게 URL을 주고 코멘트를 읽으라고 하면 "Claude lists each thread and marks the comments someone who can edit the artifact sent to it." | CC |
| Send to Claude 체크박스 (덱, 디자인) | "A **'Send to Claude'** checkbox before the send button controls whether the comment also goes to Claude as a request." 보기 전용 권한은 코멘트 불가. | KB |
| Send to Claude 체크박스 (Claude Docs) | "Where Claude is available, a 'Send to Claude' checkbox appears before the send button. It starts selected and keeps the last setting you used in that doc." | DOC |
| @Claude 멘션 (Claude Docs) | "To request an edit, mention @Claude in a comment. Claude replies in the thread, makes the change, and explains what it did and why." "Claude also leaves its own comments while drafting". "Claude acts with the permissions of the person who asked, so it can't edit for someone with only view access." | DOC |
| 여러 코멘트 묶어 보내기 | 비공식 뉴스레터 글에 "Select for Send to Claude" 체크박스로 여러 코멘트를 골라 한 번에 보낸다는 서술. 공식 문서에서는 확인 못 함. | https://getpushtoprod.substack.com/p/everything-you-need-to-know-about (비공식) |
| 백그라운드 자동 응답 | "After your session publishes an artifact, Claude Code watches that artifact for comments. When someone who can edit the artifact sends a comment to Claude, it reaches your session right away, and Claude can read the thread and reply without you asking." v2.1.228 이상. feature-flag fetching을 끄면 감시 안 함. | CC |
| 자동 응답 표시 문구 | 권한 모드가 허용하면 "`Auto-replied to comment thread on Artifact: <name>`". 승인이 필요하면 "`Comments are waiting on Artifact: <name>`"을 보여 주고 스레드 읽기와 답글 게시에 각각 승인을 묻는다. plan 모드에서는 같은 문구를 보여 주고 plan 모드를 나가 요청하기 전까지 답하지 않는다. (이 문구들은 터미널 표시이며 웹 UI의 "Auto-replied" 배지는 확인 못 함.) | CC |
| 시간당 상한 | "Claude also stops replying on its own to an artifact after it handles 60 sent comments or thread activations on that artifact within an hour. You see `Comments are waiting on Artifact: <name>` once, and Claude picks up again as that hour's comments age out." | CC |
| 자동 응답 멈추기 | 빈 프롬프트에서 Ctrl+C 한 번(모든 감시 artifact 일시 정지, 다음 메시지를 보내면 재개), `/tasks`에서 해당 작업 중지(다시 게시해도 재개 안 되고 세션 재개 후에도 유지), `Ctrl+X Ctrl+K`를 3초 안에 두 번(세션 끝까지 모든 artifact 중지). `/tasks`의 "System tasks" 행에 감시 목록. | CC |
| 감시 수명 | "A watch that Claude Code started on its own can end after the artifact goes several hours without activity." 재게시하거나 Claude에게 다시 감시하라고 하면 재시작. 코멘트 전달 서비스가 끊기면 한동안 재연결을 시도하다 감시를 중단. | CC |
| 버전별 코멘트 | 확인 못 함. 확인된 것은 게시마다 버전이 생기고 Share 컨트롤의 "Always share latest version" 토글과 "Sharing version 2" 선택기로 보는 버전을 정한다는 점. 코멘트가 버전에 묶이는지는 문서에 없음. | CC |
| 권한: 편집자 | Team과 Enterprise에서 공유 대화상자의 **viewer**를 **editor**로 바꾼다. "People you share with are viewers by default". 코멘트를 Claude에게 보내는 것은 편집 권한자만. | CC |
| 권한 단계 (claude.ai 공유) | **Can view**(읽기, 코멘트 읽기), **Commenter**(코멘트 추가와 파일 다운로드), **Can edit**. 초대받은 Commenter나 Can edit는 "can't mention people or ask Claude from a comment"(여기서는 단서가 붙은 상황이라 CC 문서와의 관계는 확인 못 함). 아티팩트 종류별로 2단계만 있는 경우도 있음. "Anyone with the link"로도 공유된 artifact에서는 초대된 코멘트 권한자도 코멘트 불가. | SH |
| Claude Docs의 권한 | "Editors can read, edit, comment on, and export a doc. Viewers can only read it." "There's no comment-only access level yet." | DOC |
| 코멘트 모드 (덱, 디자인 UI) | 패널 헤더의 **"Comment"** 버튼(열린 코멘트가 있으면 "3 open comments"처럼 개수가 이름에 붙음). 켜면 "Done commenting"으로 바뀜. 코멘트 마커는 코멘트 모드일 때만 보이고 작성자 이름이 붙는다. 덱에서는 슬라이드, 슬라이드 안의 각 객체까지 Tab으로 이동해 코멘트. 디자인은 artboard 단위. | KB |
| 작성 상자와 키 | "Add a comment" 상자. Return 또는 Cmd+Return으로 게시, 게시하면 포커스가 그 코멘트의 답글 필드로 이동. 게시한 코멘트의 수정 저장은 Cmd+Return만(Return만으로는 저장 안 됨). Escape 한 번에 상자 닫기, 또 한 번에 코멘트 모드 종료. | KB |
| 전체 코멘트 목록 | "More comment options"에서 "Show all comments", 행에서 Return하면 해당 코멘트로 이동. | KB |
| 문서(Claude Docs)에서의 코멘트 | 텍스트 선택 후 Cmd+Option+M(Windows Ctrl+Alt+M)로 "Add a comment" 상자. Shift+Return 줄바꿈, @ 멘션. 헤더 버튼은 목록 보이기와 숨기기이고 코멘트 모드를 켜지 않는다. | DOC, KB |
| 해결/삭제 | Claude Code 문서: Claude는 활성화된 스레드만 resolve할 수 있고 다른 스레드는 "a person resolves them on the page". 사람이 resolve하는 UI의 이름과 삭제 방법은 이 문서들에서 확인 못 함. 스레드 삭제 자체도 확인 못 함. KB와 DOC 둘 다 "doesn't mention resolving"이라고 되어 있음. | CC, KB, DOC |
| 알림 | SH: Commenter나 Can edit로 초대된 사람은 코멘트에 대한 이메일 알림을 받지 않는다. 터미널 알림은 위 "자동 응답 표시 문구". GitHub 기능 요청 #100904(멘션과 코멘트 알림이 없다는 요청)와 버그 #92618(보냈다고 뜨지만 세션에 안 오는 증상)이 열려 있음(이슈 본문 직접 확인은 못 하고 검색 요약만). | SH, https://github.com/anthropics/claude-code/issues/100904, https://github.com/anthropics/claude-code/issues/92618 |
| 코멘트 기록 | Claude Docs: "Comment activity isn't recorded in the Compliance API yet." | DOC |
| 관련: Edit with Claude | doc이나 Markdown 문서에서 텍스트를 선택해 "Edit with Claude"로 수정 요청. 여러 Markdown 파일에 편집 요청을 남기고 보내면 "Claude applies the whole batch in one pass". (코멘트가 아니라 별도 기능) | https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them |

## 3. 보조 (생명주기 아이디어만)

| 제품 | 동작 | 출처 |
|---|---|---|
| Google Docs | Resolve(키 `E`), 상단 "Comments"에서 닫힌 코멘트 찾기, "Re-open". 해결한 코멘트는 원본 문서에 남는다. 액션 아이템은 `@`나 `+` 이메일로 "Assign to"해 담당자에게 메일, 완료는 "Done", 열린 액션 아이템과 제안 수가 파일 우상단에 표시. 앵커 텍스트가 지워질 때의 동작은 문서에 없음(확인 못 함). | https://support.google.com/docs/answer/65129 |
| Google Docs 제안 | Suggesting 모드에서 변경이 색으로 표시되고 삭제는 취소선. 제안 위에 코멘트로 답글. 하나씩 Accept 또는 Reject, 또는 Tools > "Review suggested edits"에서 "Accept all" / "Reject all". 소유자에게 메일. | https://support.google.com/docs/answer/6033474 |
| GitHub PR | Files changed 탭에서 **Resolve conversation**(PR 작성자나 쓰기 권한자만), 접히며 resolved로 표시. Conversations 메뉴가 unresolved, resolved, outdated를 나눠 보여 준다. "outdated"의 정의와 조건은 문서에 없음(확인 못 함). 여러 줄 코멘트(첫 줄 번호 클릭 후 드래그나 Shift+클릭). **Start a review**로 모아 **Submit review** 때 한 번에 알림("Batching your comments avoids sending multiple notifications"). 제안 블록은 PR 작성자가 코멘트에서 바로 적용. | https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/commenting-on-a-pull-request |
| Linear | 코멘트 스레드, 루트 메시지의 메뉴에서 resolve. 특정 답글에서 resolve하면 그 답글이 해결안으로 강조된다. 해결된 스레드의 AI 요약은 설정 "Enable resolved thread AI summaries"가 필요. 문서 인라인 코멘트는 텍스트 선택 후 Cmd+Option+M. 코멘트 메뉴에 편집, 삭제, URL 복사, 코멘트에서 issue나 sub-issue 만들기. 코멘트에서 `@Linear`로 Linear Agent 호출. | https://linear.app/docs/comment-on-issues |
| Notion | 블록이나 선택 텍스트에 인라인 코멘트(Cmd/Ctrl+Shift+M). 코멘트 위에 올려 ✔️로 resolve, 페이지 상단 💬에서 Resolved 필터 후 ↪️로 reopen. 안 읽은 코멘트는 빨간 점. 가장 최근 답글 스레드가 위로 오지만 열려 있는 동안 재정렬 안 됨. 인라인 표시를 Default와 Minimal로 고름. 멘션은 Inbox에 빨간 배지, Notion이 열려 있는 기기에는 푸시와 이메일을 보내지 않는다. 앵커 텍스트 삭제 시 동작은 문서에 없음(확인 못 함). | https://www.notion.com/help/comments-mentions-and-reminders |

## 4. 우리 제품(HTML 슬라이드 편집기, 에이전트가 덱을 고침)에 가져올 만한 것 / 맞지 않는 것

여기부터는 의견이다. 위 표의 사실과 섞이지 않게 따로 둔다.

### 가져올 만한 것 (5개 이내)
1. 코멘트마다 "에이전트에게 보낼지" 체크박스를 두고(Send to Claude 체크박스), 마지막 선택을 기억하는 방식(Claude Docs 사례). 보내지 않는 코멘트는 사람끼리의 메모로 남는다.
2. "활성화된 스레드에만 에이전트가 답하고 resolve한다"는 경계(Claude Code Artifacts). 에이전트가 건드릴 수 있는 스레드를 사용자가 정하게 한다.
3. 에이전트 폭주 방지: 시간당 상한 후 한 번만 알리고 이후엔 대기, 그리고 중지 수단 3단계(일시 정지, 작업 중지, 세션 전체 중지). 우리는 이미 상한과 Pause를 넣었으므로 문구와 중지 단계 구분만 참고.
4. 해결 상태를 필터로 숨기고 되살릴 수 있게 하는 것(Figma의 Show resolved comments, Notion의 Resolved 필터, Google Docs의 Re-open). 해결해도 삭제가 아니라 보관이라는 점.
5. 앵커가 끊긴 코멘트를 지우지 않고 목록에 남기는 방식(Figma는 layer를 잘라 붙이면 코멘트가 분리되지만 사이드바에서 계속 보임). 덱 편집으로 대상 요소가 사라진 코멘트를 같은 식으로 "분리됨" 상태로 두는 근거가 된다.

### 맞지 않는 것 (5개 이내)
1. Figma의 시간당 100개 작성 제한, 이모지 반응, 이미지 5장 첨부: 에이전트에게 수정 요청을 보내는 용도에서는 필요성이 낮다.
2. 코멘트를 최상위 frame에만 붙이고 중첩 요소에는 안 붙이는 규칙(Figma): 우리는 슬라이드 안 CSS 경로의 요소까지 가리켜야 해서 그대로 맞지 않는다.
3. Claude Code Artifacts처럼 "내 터미널 세션이 살아 있는 동안만 감시"하는 구조(감시가 몇 시간 무활동이면 끝남, 재게시나 재요청으로 재시작): 우리는 채널이 상시 연결이라 같은 수명 모델이 필요 없다.
4. Google Docs의 액션 아이템 담당자 지정, Linear의 코멘트에서 issue 만들기: 협업 인원이 많은 제품용 기능이다.
5. GitHub의 Start a review로 모았다가 한 번에 제출하는 방식: 이미 묶음 전달이 있고, 에이전트가 즉시 반응하는 흐름과 충돌하지 않는지는 별도 판단이 필요하다. (GitHub 문서는 Copilot PR에서 이 방식이 개별 코멘트에 대한 착수를 막는다고 명시.)

## 5. 확인 못 한 항목 (요약)
- Figma Slides 전용 코멘트 동작(발표 모드 포함): 공식 문서 못 찾음.
- Figma에서 frame 삭제 시 앵커 동작, 일괄 해결/삭제, 코멘트 사이 키보드 이동, 읽지 않음의 시각 표시.
- Claude Artifacts: 버전별 코멘트, 웹 UI의 "Auto-replied" 표시(터미널 문구만 확인), 사람이 resolve하는 UI 이름, 코멘트 삭제, 코멘트 알림(이메일은 없다고만 확인).
- GitHub의 "outdated" 정의, Google Docs와 Notion의 앵커 텍스트 삭제 시 동작.
