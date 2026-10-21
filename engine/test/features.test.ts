import { expect, test } from "bun:test";
import { deployEnabled, publishHost } from "../features";

test("publishHost: https 호스트만, 끝의 /는 떼고, 경로나 http나 공백이나 빈 값은 빈 문자열", () => {
  expect(publishHost({ SLIDEKIT_PUBLISH_HOST: "https://static.example.com" })).toBe("https://static.example.com");
  expect(publishHost({ SLIDEKIT_PUBLISH_HOST: " https://static.example.com/// " })).toBe("https://static.example.com");
  expect(publishHost({ SLIDEKIT_PUBLISH_HOST: "https://localhost:8787" })).toBe("https://localhost:8787");
  for (const bad of ["", "http://static.example.com", "https://static.example.com/path", "https://", "static.example.com", "https://a b.com", "https://-x.com", "javascript:alert(1)", "https://x.com?q=1", "https://user@x.com"]) expect(publishHost({ SLIDEKIT_PUBLISH_HOST: bad }), bad).toBe("");
  expect(publishHost({})).toBe("");
});

test("deployEnabled: 스위치와 올바른 호스트가 둘 다 있어야 켜진다(기본 꺼짐)", () => {
  expect(deployEnabled({})).toBe(false);
  expect(deployEnabled({ SLIDEKIT_EXPERIMENTAL_DEPLOY: "1" })).toBe(false);
  expect(deployEnabled({ SLIDEKIT_PUBLISH_HOST: "https://static.example.com" })).toBe(false);
  expect(deployEnabled({ SLIDEKIT_EXPERIMENTAL_DEPLOY: "true", SLIDEKIT_PUBLISH_HOST: "https://static.example.com" })).toBe(false);
  expect(deployEnabled({ SLIDEKIT_EXPERIMENTAL_DEPLOY: "1", SLIDEKIT_PUBLISH_HOST: "http://static.example.com" })).toBe(false);
  expect(deployEnabled({ SLIDEKIT_EXPERIMENTAL_DEPLOY: "1", SLIDEKIT_PUBLISH_HOST: "https://static.example.com" })).toBe(true);
});
