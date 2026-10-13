import { Suspense, lazy, useEffect, useState, type ComponentType, type ReactNode } from "react";

// 화면마다 따로 받는다. 목록 화면이 편집기와 발표자 화면의 코드를 가져오지 않는다.
const DeckList = lazy(() => import("./DeckList").then((m) => ({ default: m.DeckList })));
const Presenter = lazy(() => import("./Presenter").then((m) => ({ default: m.Presenter })));
const Editor = lazy(() => import("./Editor").then((m) => ({ default: m.Editor })));

// 개발용 데모 라우트는 production 번들에서 빠진다(NODE_ENV 분기는 번들 때 접혀 import가 사라진다).
const dev: Record<string, ComponentType> = {};
if (process.env.NODE_ENV !== "production") {
  dev["/dev/inspector"] = lazy(() => import("./InspectorDemo").then((m) => ({ default: m.InspectorDemo })));
  dev["/dev/tokens"] = lazy(() => import("./TokensDemo").then((m) => ({ default: m.TokensDemo })));
  dev["/dev/controls"] = lazy(() => import("./ControlStates").then((m) => ({ default: m.ControlStates })));
  dev["/dev/export"] = lazy(() => import("./ExportDemo").then((m) => ({ default: m.ExportDemo })));
}

export function go(path: string) {
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

// 받는 동안은 빈 화면 그대로 둔다(스켈레톤이 잠깐 번쩍이는 것보다 덜 거슬린다).
const Page = ({ children }: { children: ReactNode }) => <Suspense fallback={<div className="h-full" />}>{children}</Suspense>;

export function App() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  const Demo = dev[path];
  if (Demo) return <Page><Demo /></Page>;
  const p = path.match(/^\/present\/([^/]+)/);
  if (p) return <Page><Presenter id={decodeURIComponent(p[1])} /></Page>;
  const e = path.match(/^\/edit\/([^/]+)/);
  return <Page>{e ? <Editor id={decodeURIComponent(e[1])} /> : <DeckList />}</Page>;
}
