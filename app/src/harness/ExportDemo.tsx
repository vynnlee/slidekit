// 테스트 하네스(제품 화면이 아니다): export.cjs 검사가 부품을 단독으로 띄우려고 쓴다. /dev/* 경로는 개발 서버에서만 열리고 production 번들과 서버 라우트에서 빠진다.
// /dev/export?deck=<폴더>: ExportMenu을 편집기 없이 검증하는 개발용 페이지.
import { ExportMenu } from "@/ExportMenu";

export function ExportDemo() {
  const folder = new URLSearchParams(location.search).get("deck") ?? "";
  return <div className="flex min-h-screen justify-end bg-background p-2 text-foreground"><ExportMenu folder={folder} /></div>;
}
