import { DEFAULT_MS, QUICK, applyQuick, matchQuick, setMs, type ListRow, type Start, type StepSpec } from "@/lib/animation-model";

// 애니메이션 목록과 인스펙터가 함께 쓰는 세 칸: 효과, 시작 방식, 시간(spec/ANIMATION.md 4절). 네이티브 select라 키보드와 스크린 리더가 그대로 된다.
// 효과와 시간은 요소 하나의 값이라 등장 줄과 퇴장 줄이 같다: 등장이 있는 요소의 퇴장 줄에서는 바꿀 수 없다(linked).
const TIMES = [0, 200, 300, 360, 500, 800, 1000, 1500, 2000];
const sec = (ms: number) => `${ms / 1000}s`;
const SEL = "h-6 min-w-0 rounded-md bg-hover px-1 text-caption text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50";

type Props = {
  row: ListRow;
  spec: StepSpec;
  first: boolean; // 목록의 첫 줄은 항상 On click
  linked: boolean;
  labels?: boolean; // 인스펙터: 칸 이름을 보인다
  name: string;
  onSpec(next: StepSpec): void;
  onStart(s: Start): void;
};

export function AnimControls({ row, spec, first, linked, labels, name, onSpec, onStart }: Props) {
  const quick = matchQuick(spec), ms = spec.ms ?? DEFAULT_MS, times = TIMES.includes(ms) ? TIMES : [...TIMES, ms].sort((a, b) => a - b);
  const what = `${name} ${row.kind === "in" ? "In" : "Out"}`;
  const w = (c: string) => (labels ? "" : c); // 목록에서는 칸 너비를 맞춰 줄마다 세로로 정렬한다
  const field = (label: string, el: React.ReactNode) => labels
    ? <label className="flex items-center justify-between gap-2"><span className="text-micro text-muted-foreground">{label}</span>{el}</label>
    : el;
  return (
    <>
      {field("Effect", (
        <select aria-label={`Effect of ${what}`} value={quick ?? "custom"} disabled={linked} title={linked ? "Same as In" : undefined} className={`${SEL} ${w("w-[4.5rem]")}`}
          onChange={(e) => onSpec(applyQuick(spec, e.target.value))}>
          {QUICK.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          {quick === null && <option value="custom" disabled>Custom</option>}
        </select>
      ))}
      {field("Start", (
        <select aria-label={`Start of ${what}`} value={first ? "click" : row.start} disabled={first} className={`${SEL} ${w("w-[7.5rem]")}`} onChange={(e) => onStart(e.target.value as Start)}>
          <option value="click">On click</option>
          <option value="with">With previous</option>
          <option value="after" disabled={linked}>After previous</option>
        </select>
      ))}
      {field("Duration", (
        <select aria-label={`Duration of ${what}`} value={ms} disabled={linked} title={linked ? "Same as In" : undefined} className={`${SEL} ${w("w-16")}`} onChange={(e) => onSpec(setMs(spec, +e.target.value))}>
          {times.map((t) => <option key={t} value={t}>{sec(t)}</option>)}
        </select>
      ))}
    </>
  );
}
