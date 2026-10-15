import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { onReconnect } from "@/lib/connection";

// 렌더 오류가 나도 흰 화면 대신 복구 버튼을 보여 준다.
// 오프라인에서 화면 코드(lazy 청크)를 못 받은 경우는 연결 문제로 안내하고, 연결이 돌아오면 스스로 다시 불러온다.
const CHUNK = /dynamically imported module|Loading chunk|Failed to fetch|Importing a module script failed/i;

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean; offline: boolean; details: string; copied: boolean }> {
  state = { failed: false, offline: false, details: "", copied: false };
  off: (() => void) | null = null;
  static getDerivedStateFromError(e: unknown) { return { failed: true, offline: CHUNK.test(String((e as Error)?.message ?? e)) }; }
  // 원인을 추적할 수 있게 메시지, 스택, 컴포넌트 스택을 한 덩어리로 남기고(콘솔과 window.__skLastError), 화면의 Copy details로 복사하게 한다.
  componentDidCatch(e: unknown, info?: { componentStack?: string | null }) {
    const err = e as Error;
    const details = [`${err?.name ?? "Error"}: ${err?.message ?? String(e)}`, err?.stack ?? "", info?.componentStack ? `Component stack:${info.componentStack}` : "", `URL: ${location.pathname}`].filter(Boolean).join("\n");
    (window as unknown as { __skLastError?: string }).__skLastError = details;
    this.setState({ details });
    console.error("[slidekit] render error\n" + details);
  }
  componentDidUpdate() {
    if (this.state.offline && !this.off) this.off = onReconnect(() => location.reload());
  }
  componentWillUnmount() { this.off?.(); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 text-body text-muted-foreground">
        <p>{this.state.offline ? "Connection lost. This screen reloads when the server is back." : "Something went wrong."}</p>
        {location.pathname.startsWith("/edit/") && !this.state.offline && <p className="max-w-sm text-center text-caption">The editor saves automatically. Reloading opens the last saved version.</p>}
        <div className="flex items-center gap-2">
          <Button variant="primary" size="compact" onClick={() => location.reload()}>Reload</Button>
          {!this.state.offline && this.state.details && (
            <Button variant="ghost" size="compact" onClick={() => { navigator.clipboard?.writeText(this.state.details).then(() => this.setState({ copied: true })).catch(() => {}); }}>{this.state.copied ? "Copied" : "Copy details"}</Button>
          )}
        </div>
      </div>
    );
  }
}
