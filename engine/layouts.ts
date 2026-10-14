/* 슬라이드 레이아웃 프리셋의 목록 원천(SPEC 2.1). 편집기의 슬라이드 추가, `slidekit layouts`, lint, SKILL이 이 목록을 함께 쓴다.
   레이아웃은 슬라이드 종류가 아니라 content의 변형이다: <section data-slide="content" data-layout="<id>">.
   예제 문구는 모두 "여기에 적는다" 꼴(title-body만 편집기 호환으로 "제목", "내용")이라 lint의 placeholder 경고가 배포 전에 잡는다. */

export type Layout = {
  id: string;
  /** 사람이 읽는 이름(앱 UI는 영어) */
  label: string;
  /** 언제 쓰는지 한 줄 */
  hint: string;
  /** 새 슬라이드 HTML 조각. 들여쓰기는 덱 파일의 body 직계 기준(2칸) */
  html: string;
};

export const LAYOUTS: Layout[] = [
  {
    id: "title-body",
    label: "Title and body",
    hint: "핵심 문장 하나와 뒷받침하는 설명",
    html: `<section data-slide="content">\n    <h2>제목</h2>\n    <p>내용</p>\n  </section>`,
  },
  {
    id: "two-column",
    label: "Two columns",
    hint: "비교, 전과 후, 글과 그림처럼 둘을 나란히 놓을 때",
    html: `<section data-slide="content" data-layout="two-column">\n    <h2>두 열의 제목을 여기에 적는다</h2>\n    <div data-col>\n      <h3>왼쪽 소제목을 여기에 적는다</h3>\n      <p>왼쪽 설명을 여기에 적는다</p>\n    </div>\n    <div data-col>\n      <h3>오른쪽 소제목을 여기에 적는다</h3>\n      <p>오른쪽 설명을 여기에 적는다</p>\n    </div>\n  </section>`,
  },
  {
    id: "big-number",
    label: "Big number",
    hint: "숫자 하나로 말할 때",
    html: `<section data-slide="content" data-layout="big-number">\n    <p data-big>42%</p>\n    <p>숫자가 뜻하는 내용을 여기에 적는다</p>\n  </section>`,
  },
  {
    id: "quote",
    label: "Quote",
    hint: "인용과 출처",
    html: `<section data-slide="content" data-layout="quote">\n    <blockquote>\n      <p>인용문을 여기에 적는다</p>\n      <footer>출처를 여기에 적는다</footer>\n    </blockquote>\n  </section>`,
  },
  {
    id: "image-full",
    label: "Full image",
    hint: "이미지가 슬라이드를 채울 때(글은 아래쪽에 겹친다)",
    html: `<section data-slide="content" data-layout="image-full">\n    <img alt="이미지 설명을 여기에 적는다" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">\n    <h2>이미지 제목을 여기에 적는다</h2>\n  </section>`,
  },
];

export const LAYOUT_IDS = LAYOUTS.map((l) => l.id);
export const layoutById = (id: string) => LAYOUTS.find((l) => l.id === id);
