import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { onReconnect } from "@/lib/connection";

// 렌더 오류가 나도 흰 화면 대신 복구 버튼을 보여 준다.
// 오프라인에서 화면 코드(lazy 청크)를 못 받은 경우는 연결 문제로 안내하고, 연결이 돌아오면 스스로 다시 불러온다.
const CHUNK = /dynamically imported module|Loading chunk|Failed to fetch|Importing a module script failed/i;

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean; offline: boolean }> {
  state = { failed: false, offline: false };
  off: (() => void) | null = null;
  static getDerivedStateFromError(e: unknown) { return { failed: true, offline: CHUNK.test(String((e as Error)?.message ?? e)) }; }
  componentDidCatch(e: unknown) { console.error(e); }
  componentDidUpdate() {
    if (this.state.offline && !this.off) this.off = onReconnect(() => location.reload());
  }
  componentWillUnmount() { this.off?.(); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 text-body text-muted-foreground">
        <p>{this.state.offline ? "Connection lost. This screen reloads when the server is back." : "Something went wrong."}</p>
        <Button variant="primary" size="compact" onClick={() => location.reload()}>Reload</Button>
      </div>
    );
  }
}
