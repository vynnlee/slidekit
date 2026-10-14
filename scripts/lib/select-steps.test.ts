import { expect, test } from "bun:test";
import { selectSteps } from "./select-steps";

const names = ["roundtrip", "editor", "editor-assets", "editor-multi", "inspector", "inspector-a11y", "unit-other", "unit-isolated", "channel", "channel-resilience", "channel-trust", "ux-shots-1440", "ux-shots-390", "bundler-bundle", "bundler-fonts", "bundler-fonts-e2e"];

test("--only 이름은 정확 일치: editor는 editor 하나, inspector는 inspector 하나", () => {
  expect(selectSteps(names, ["editor"]).picked).toEqual(["editor"]);
  expect(selectSteps(names, ["inspector"]).picked).toEqual(["inspector"]);
});

test("글로브는 *가 있을 때만: editor*는 editor로 시작하는 모두", () => {
  expect(selectSteps(names, ["editor*"]).picked).toEqual(["editor", "editor-assets", "editor-multi"]);
  expect(selectSteps(names, ["*-e2e"]).picked).toEqual(["bundler-fonts-e2e"]);
});

test("그룹 별칭은 예전 부분 일치 호출을 그대로 살린다: unit, channel, ux-shots, bundler", () => {
  expect(selectSteps(names, ["unit"]).picked).toEqual(["unit-other", "unit-isolated"]);
  expect(selectSteps(names, ["channel"]).picked).toEqual(["channel", "channel-resilience", "channel-trust"]);
  expect(selectSteps(names, ["ux-shots"]).picked).toEqual(["ux-shots-1440", "ux-shots-390"]);
  expect(selectSteps(names, ["bundler"]).picked.length).toBe(3);
});

test("여러 값은 합치고 순서는 단계 순서, 맞는 게 없으면 비슷한 이름을 알려 준다, --changed의 정확 표시", () => {
  expect(selectSteps(names, ["unit-other", "editor-assets", "roundtrip"]).picked).toEqual(["roundtrip", "editor-assets", "unit-other"]);
  const r = selectSteps(names, ["edit"]);
  expect(r.picked).toEqual([]);
  expect(r.missing[0].similar).toEqual(["editor", "editor-assets", "editor-multi"]);
  expect(selectSteps(names, ["\u0000editor"]).picked).toEqual(["editor"]);
  expect(selectSteps(names, ["\u0000nope"]).missing[0].ask).toBe("nope");
});
