// 오류 경계 시험용: 렌더 중에 던진다. deck 쿼리가 있으면 주소를 /edit/<덱>으로 바꿔 편집기에서 난 오류처럼 보이게 한다. production 번들에는 없다(App.tsx의 dev 라우트).
export function Boom(): null {
  const id = new URLSearchParams(location.search).get("deck");
  if (id) history.replaceState(null, "", `/edit/${id}`);
  throw new Error("Boom: test render error");
}
