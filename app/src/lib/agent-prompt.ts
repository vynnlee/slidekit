// 배포 완료 화면의 "Copy agent prompt" 문구(spec/DECK-MD-DEPLOY.md 4절, 실험 기능). 순수 함수.
// 공개 덱은 deck.md를 curl로 받게 하고, 비밀번호 덱은 주소만 준다(비밀번호도 curl도 넣지 않는다: 로그인한 브라우저에서만 열린다).
// host는 서버가 알려 주는 설정된 게시 호스트(SLIDEKIT_PUBLISH_HOST)다. 설정이 없으면 만들지 않는다.

/** 게시된 주소(host/이름)가 아니면 null(단추를 숨기거나 복사하지 않는다). */
export function agentPrompt(url: string, visibility: "public" | "password", host: string): string | null {
  if (!host || !url.startsWith(`${host}/`) || !/^[\w-]+$/.test(url.slice(host.length + 1))) return null;
  if (visibility === "password") return `This deck is password protected: ${url}\nAsk me for its contents.`;
  return `Read this slide deck and help me continue it.\nDeck: ${url}\nMarkdown (all slide text, no speaker notes): curl -s ${url}/deck.md`;
}
