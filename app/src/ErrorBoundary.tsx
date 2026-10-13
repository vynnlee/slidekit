import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

// 렌더 오류가 나도 흰 화면 대신 복구 버튼을 보여 준다.
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.error(e); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 text-body text-muted-foreground">
        <p>Something went wrong.</p>
        <Button variant="primary" size="compact" onClick={() => location.reload()}>Reload</Button>
      </div>
    );
  }
}
