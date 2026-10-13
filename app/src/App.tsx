import { useEffect, useState } from "react";
import { DeckList } from "./DeckList";
import { Presenter } from "./Presenter";
import { Editor } from "./Editor";
import { InspectorDemo } from "./InspectorDemo";

export function go(path: string) {
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function App() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  if (path === "/dev/inspector") return <InspectorDemo />;
  const p = path.match(/^\/present\/([^/]+)/);
  if (p) return <Presenter id={decodeURIComponent(p[1])} />;
  const e = path.match(/^\/edit\/([^/]+)/);
  return e ? <Editor id={decodeURIComponent(e[1])} /> : <DeckList />;
}
