/* deck-meta 필드 표와 검증(SPEC 5절). DOM과 node 모듈을 쓰지 않는 순수 모듈이라 서버, 편집기(브라우저 번들), lint가 모두 import한다.
   - validateMeta: 파일에 있는 deck-meta 전체 객체 검증(알 수 없는 키는 엔진이 그대로 통과시키므로 허용). lint가 쓴다.
   - validatePatch: 편집기가 보내는 변경분 검증(알 수 없는 키, id, 비밀번호 계열 키는 거부). msg는 UI에 그대로 보이는 영어 한 줄이다.
   - applyPatch: 검증된 변경분을 적용한다. subtitle, author, date, lang, visibility, pageNumber, progress는 null이나 빈 문자열이면 키를 지운다(title은 지울 수 없다). */

export type FieldSpec = {
  key: string;
  /** UI 라벨(영어) */
  label: string;
  kind: "string" | "boolean";
  max?: number;
  required?: boolean;
  /** 패치로 바꿀 수 없는 필드 */
  readonly?: boolean;
  /** 문자열이면 허용되는 값 */
  enum?: string[];
  pattern?: RegExp;
};

export const META_FIELDS: FieldSpec[] = [
  { key: "title", label: "Title", kind: "string", max: 120, required: true },
  { key: "subtitle", label: "Subtitle", kind: "string", max: 200 },
  { key: "author", label: "Author", kind: "string", max: 120 },
  { key: "date", label: "Date", kind: "string", pattern: /^\d{4}-\d{2}-\d{2}$/ },
  { key: "lang", label: "Language", kind: "string", pattern: /^[a-z]{2}(-[A-Z]{2})?$/ },
  { key: "visibility", label: "Visibility", kind: "string", enum: ["public", "password"] },
  { key: "pageNumber", label: "Page numbers", kind: "boolean" },
  { key: "progress", label: "Progress bar", kind: "boolean" },
  { key: "id", label: "Deck id", kind: "string", pattern: /^[a-z0-9-]+$/, readonly: true },
];
export const knownFields = META_FIELDS.map((f) => f.key);

export type MetaIssue = { field: string; code: string; msg: string };

/** 이 키들은 덱 파일에 절대 넣지 않는다(비밀번호는 게시할 때만 받고 해시로 올린다). */
const SECRET_KEY = /pass|secret|token/i;

const oneLine = (s: string) => !/[\r\n]/.test(s);
const realDate = (s: string) => { const d = new Date(`${s}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; };

function check(f: FieldSpec, v: unknown): MetaIssue | null {
  const err = (code: string, msg: string): MetaIssue => ({ field: f.key, code, msg });
  if (f.kind === "boolean") return typeof v === "boolean" ? null : err("boolean", `${f.label} must be on or off.`);
  if (typeof v !== "string") return err(({ title: "title-missing", date: "date-format", visibility: "visibility", id: "id-format", lang: "lang-format" } as Record<string, string>)[f.key] ?? `${f.key}-type`, `${f.label} must be text.`);
  if (f.key === "title" && !v.trim()) return err("title-missing", "Title is required.");
  if (f.max !== undefined && (v.length > f.max || !oneLine(v))) return err(`${f.key}-format`, `${f.label} must be ${f.required ? "1" : "up to"}${f.required ? " to" : ""} ${f.max} characters on one line.`);
  if (f.enum && !f.enum.includes(v)) return err("visibility", `${f.label} must be ${f.enum.join(" or ")}.`);
  if (f.pattern && !f.pattern.test(v)) {
    if (f.key === "date") return err("date-format", "Date must be a real date like 2026-10-14.");
    if (f.key === "lang") return err("lang-format", "Language must be a code like ko or en-US.");
    return err("id-format", "The deck id may use lowercase letters, numbers and hyphens only.");
  }
  if (f.key === "date" && !realDate(v)) return err("date-calendar", "Date must be a real date like 2026-10-14.");
  return null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** deck-meta 전체 객체 검증. 없는 선택 필드(undefined, null)는 건너뛴다. */
export function validateMeta(meta: unknown): MetaIssue[] {
  if (!isObject(meta)) return [{ field: "", code: "not-object", msg: "The deck-meta block must be a JSON object." }];
  const out: MetaIssue[] = [];
  for (const f of META_FIELDS) {
    const v = meta[f.key];
    if (v === undefined || v === null) { if (f.required) out.push({ field: f.key, code: "title-missing", msg: "Title is required." }); continue; }
    const e = check(f, v);
    if (e) out.push(e);
  }
  return out;
}

/** 편집기가 보내는 변경분 검증. 알 수 없는 키, 읽기 전용 키, 비밀번호 계열 키는 거부한다. */
export function validatePatch(patch: unknown): MetaIssue[] {
  if (!isObject(patch)) return [{ field: "", code: "not-object", msg: "The change must be a JSON object." }];
  const out: MetaIssue[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (SECRET_KEY.test(k)) { out.push({ field: k, code: "secret", msg: "Passwords are never stored in the deck. Set one when you publish." }); continue; }
    const f = META_FIELDS.find((x) => x.key === k);
    if (!f) { out.push({ field: k, code: "unknown", msg: `Unknown setting "${k}".` }); continue; }
    if (f.readonly) { out.push({ field: k, code: "readonly", msg: `${f.label} cannot be changed here.` }); continue; }
    if (v === null || v === "") { // 지우기: title만 못 지운다
      if (f.required) out.push({ field: k, code: "title-missing", msg: "Title is required." });
      continue;
    }
    const e = check(f, v);
    if (e) out.push(e);
  }
  return out;
}

/** 검증을 통과한 변경분을 적용한 새 객체를 돌려준다(기존 키 순서를 지키고 새 키는 뒤에 붙인다). 원본은 바꾸지 않는다. */
export function applyPatch(meta: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...meta };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === "") delete out[k];
    else out[k] = typeof v === "string" ? v.trim() : v;
  }
  return out;
}
