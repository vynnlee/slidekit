import { expect, test } from "bun:test";
import { META_FIELDS, applyPatch, knownFields, validateMeta, validatePatch } from "../deck-meta";
import { lint } from "../lint";

const ok = `<!doctype html><html data-slidekit="1"><head><script type="application/json" id="deck-meta">__META__</script></head><body><section data-slide="cover"><h1>t</h1></section><script src="../../engine/slidekit.js"></script></body></html>`;
const lintErr = (meta: unknown) => lint(ok.replace("__META__", typeof meta === "string" ? meta : JSON.stringify(meta))).filter((i) => i.rule === "deck-meta");

test("필드 표: 키 목록과 id만 읽기 전용", () => {
  expect(knownFields).toEqual(["title", "subtitle", "author", "date", "lang", "visibility", "pageNumber", "progress", "id"]);
  expect(META_FIELDS.filter((f) => f.readonly).map((f) => f.key)).toEqual(["id"]);
});
test("validateMeta: 올바른 값은 통과, 틀린 값은 필드와 코드와 영어 한 줄", () => {
  expect(validateMeta({ title: "t", subtitle: "s", author: "a", date: "2026-10-14", lang: "en-US", visibility: "password", pageNumber: true, progress: false, id: "my-talk", extra: 1 })).toEqual([]);
  const bad = validateMeta({ title: "", date: "2026-02-30", lang: "KO", visibility: "x", pageNumber: "yes", id: "A b", subtitle: "a\nb", author: "x".repeat(121) });
  expect(bad.map((i) => i.field).sort()).toEqual(["author", "date", "id", "lang", "pageNumber", "subtitle", "title", "visibility"]);
  expect(bad.every((i) => i.msg && !i.msg.includes("\n"))).toBe(true);
  expect(validateMeta(null)[0].code).toBe("not-object");
  expect(validateMeta({}).map((i) => i.code)).toEqual(["title-missing"]);
});
test("validatePatch: 알 수 없는 키, id, 비밀번호 계열 키는 거부", () => {
  expect(validatePatch({ title: "새 제목", author: "", subtitle: null, pageNumber: true, lang: "ko" })).toEqual([]);
  const r = validatePatch({ id: "x", password: "pw", passphrase: "x", api_token: "t", secretKey: "s", foo: 1, title: "" });
  expect(Object.fromEntries(r.map((i) => [i.field, i.code]))).toEqual({ id: "readonly", password: "secret", passphrase: "secret", api_token: "secret", secretKey: "secret", foo: "unknown", title: "title-missing" });
  expect(validatePatch({ date: "26-1-1" })[0].code).toBe("date-format");
  expect(validatePatch({ date: "2026-13-01" })[0].code).toBe("date-calendar");
  expect(validatePatch({ date: "2026-02-30" })[0].code).toBe("date-calendar");
  expect(validatePatch({ pageNumber: "true" })[0].code).toBe("boolean");
  expect(validatePatch([])[0].code).toBe("not-object");
});
test("applyPatch: null이나 빈 문자열은 키 삭제, 순서 유지, 문자열은 다듬고, 원본은 그대로", () => {
  const meta = { title: "a", author: "me", date: "2026-10-14", id: "x" };
  const out = applyPatch(meta, { title: " b ", author: "", date: null, subtitle: "s" });
  expect(out).toEqual({ title: "b", id: "x", subtitle: "s" });
  expect(Object.keys(out)).toEqual(["title", "id", "subtitle"]);
  expect(meta.author).toBe("me");
});
test("lint가 이 모듈을 쓴다: 기존 오류 메시지는 그대로, 새 규칙은 경고", () => {
  expect(lintErr({}).map((i) => [i.level, i.msg])).toEqual([["error", 'deck-meta에 title이 없다. "title": "덱 제목"을 적는다']]);
  expect(lintErr({ title: "t", date: "26-1-1" }).map((i) => [i.level, i.msg])).toEqual([["error", "deck-meta의 date 형식이 틀렸다. 2026-10-14처럼 적는다"]]);
  expect(lintErr({ title: "t", visibility: "x" }).map((i) => [i.level, i.msg])).toEqual([["error", 'deck-meta의 visibility는 "public" 또는 "password"여야 한다']]);
  expect(lintErr({ title: "t", id: "A" }).map((i) => [i.level, i.msg])).toEqual([["error", "deck-meta의 id는 영문 소문자, 숫자, -만 쓴다(예: my-talk)"]]);
  expect(lintErr("{").map((i) => i.msg)).toEqual(["deck-meta JSON을 읽지 못했다. 쉼표와 따옴표를 확인한다"]);
  const w = lintErr({ title: "t", lang: "KO", pageNumber: "yes", date: "2026-02-30" });
  expect(w.map((i) => i.level)).toEqual(["warn", "warn", "warn"]);
  expect(lintErr({ title: "t", lang: "en-US", pageNumber: true, progress: true })).toEqual([]);
});

test("보안 감사: 제어 문자와 유니코드 줄 구분자와 양방향 제어 문자 거부, 공백만 있는 값은 지우기로 본다", () => {
  for (const bad of ["a\u0000b", "a\u000bb", "a\u000cb", "a\u0085b", "a b", "a b", "gnp‮fdp.exe", "a⁦b"])
    expect(validatePatch({ title: bad })[0]?.code, JSON.stringify(bad)).toBe("title-format");
  expect(validatePatch({ subtitle: "   ", author: "\t" })).toEqual([]);
  expect(applyPatch({ subtitle: "x", author: "y", title: "t" }, { subtitle: "   ", author: " \n " })).toEqual({ title: "t" });
  expect(validatePatch({ title: "   " })[0].code).toBe("title-missing");
  expect(validatePatch({ title: " " + "가".repeat(120) + " " })).toEqual([]); // 길이는 다듬은 뒤 기준
  expect(validateMeta({ title: "ok", subtitle: "a‮b" })[0].field).toBe("subtitle");
});
