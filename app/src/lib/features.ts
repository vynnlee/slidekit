import { useEffect, useState } from "react";

// 서버의 실험 기능 스위치(/api/features, engine/features.ts). 배포는 기본 꺼짐이라 응답을 받기 전에는 꺼진 것으로 본다.
export type Features = { deploy: boolean; publishHost: string };
const OFF: Features = { deploy: false, publishHost: "" };
let cached: Promise<Features> | null = null;
const load = () => (cached ??= fetch("/api/features").then((r) => (r.ok ? r.json() : OFF), () => OFF).then((j: Partial<Features>) => ({ deploy: j.deploy === true && typeof j.publishHost === "string" && j.publishHost !== "", publishHost: typeof j.publishHost === "string" ? j.publishHost : "" })));

export function useFeatures(): Features {
  const [f, setF] = useState<Features>(OFF);
  useEffect(() => { let live = true; void load().then((x) => { if (live) setF(x); }); return () => { live = false; }; }, []);
  return f;
}
