// /dev/export?deck=<폴더>: ExportMenu을 편집기 없이 검증하는 개발용 페이지.
import { ExportMenu } from "@/ExportMenu";

export function ExportDemo() {
  const folder = new URLSearchParams(location.search).get("deck") ?? "";
  return <div className="flex min-h-screen justify-end bg-background p-2 text-foreground"><ExportMenu folder={folder} /></div>;
}
