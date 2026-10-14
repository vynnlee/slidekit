// data-step 요소의 등장 효과 목록. 값은 data-step-effect에 쓰고 CSS는 engine/slidekit.css에 있다.
// 편집기 Inspector 같은 곳은 이 목록을 가져다 쓴다. 효과를 더하면 CSS와 SPEC 6.3절도 함께 고친다.
export const STEP_EFFECTS = [
  ["rise", "Rise"], // 기본. 투명도와 20px 위로 올라오기
  ["fade", "Fade"],
  ["left", "Slide"], // 왼쪽 32px에서 밀려 들어오기
  ["scale", "Scale"], // 92%에서 커지기
  ["blur", "Blur"], // 흐림에서 선명해지기
  ["none", "None"], // 즉시
] as const;
export const DEFAULT_STEP_EFFECT = "rise";
export type StepEffect = (typeof STEP_EFFECTS)[number][0];
