import { useEffect, useState } from "react";
import { DeckList } from "./DeckList";
import { Presenter } from "./Presenter";

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
  const m = path.match(/^\/present\/([^/]+)/);
  return m ? <Presenter id={decodeURIComponent(m[1])} /> : <DeckList />;
}
