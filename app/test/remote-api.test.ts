import { expect, test } from "bun:test";
import { createHub, parseCmd, parseState, TTL_MS, type Sink } from "../remote-api";

const sink = () => { const got: [string, any][] = []; let closed = false; return { got, get closed() { return closed; }, s: { send: (e, d) => { got.push([e, d]); }, close: () => { closed = true; } } as Sink }; };
const setup = () => { let t = 1_000_000; const hub = createHub(() => t); return { hub, tick: (ms: number) => { t += ms; } }; };
const code = (c: string) => c.replace("-", "");

test("parseCmd: 허용한 명령만 통과", () => {
  expect(parseCmd({ type: "next" })).toEqual({ type: "next" });
  expect(parseCmd({ type: "goto", n: 12 })).toEqual({ type: "goto", n: 12 });
  expect(parseCmd({ type: "blank", mode: "white" })).toEqual({ type: "blank", mode: "white" });
  expect(parseCmd({ type: "timer", action: "reset" })).toEqual({ type: "timer", action: "reset" });
  for (const b of [null, "next", {}, { type: "save" }, { type: "delete" }, { type: "goto", n: 0 }, { type: "goto", n: 1.5 }, { type: "goto", n: 10000 }, { type: "goto", n: "3" }, { type: "blank", mode: "red" }, { type: "timer", action: "x" }]) expect(parseCmd(b)).toBeNull();
  expect(parseCmd({ type: "next", path: "/etc/passwd" })).toEqual({ type: "next" }); // 여분 필드는 버린다
});

test("parseState: 길이와 범위를 자르고 잘못된 값은 거절", () => {
  expect(parseState({ slide: 0, total: 3 })).toBeNull();
  expect(parseState({ slide: 1 })).toBeNull();
  const s = parseState({ slide: 2, total: 5, title: "x".repeat(500), notes: "n".repeat(20000), elapsed: -3, running: "yes", blank: "red", target: 5 })!;
  expect(s.title.length).toBe(200); expect(s.notes.length).toBe(8000);
  expect(s.elapsed).toBe(0); expect(s.running).toBe(false); expect(s.blank).toBeNull(); expect(s.target).toBe(5);
});

test("페어링: 코드는 1회용이고 대소문자와 하이픈을 무시한다", () => {
  const { hub } = setup();
  const r = hub.start("d")!;
  expect(r.code).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}$/);
  const j = hub.join("d", code(r.code).toLowerCase());
  expect("token" in j).toBe(true);
  expect(hub.join("d", r.code)).toEqual({ error: "code" }); // 두 번째는 거절
  expect(hub.join("nope", r.code)).toEqual({ error: "none" });
});

test("틀린 코드는 분당 5번까지, 그 뒤엔 맞는 코드도 거절하고 폐기된 코드는 1분 뒤에도 못 쓴다", () => {
  const { hub, tick } = setup();
  const r = hub.start("d")!;
  for (let i = 0; i < 5; i++) expect(hub.join("d", "AAAA-AAAA")).toEqual({ error: "code" });
  expect(hub.join("d", r.code)).toEqual({ error: "limit" });
  tick(61_000);
  expect(hub.join("d", r.code)).toEqual({ error: "code" }); // 한도에서 코드가 폐기됐다
  expect("token" in hub.join("d", hub.start("d", r.host)!.code)).toBe(true); // 발표자 키로 새 코드
});

test("명령: 토큰 검사, 발표자가 없으면 offline, 초당 10회 제한", () => {
  const { hub, tick } = setup();
  const r = hub.start("d")!;
  const { token } = hub.join("d", r.code) as { token: string };
  expect(hub.command("d", "bad", { type: "next" })).toBe("auth");
  expect(hub.command("d", token, { type: "next" })).toBe("offline");
  tick(1100); // 거절된 시도도 속도 제한에 센다
  const h = sink();
  hub.subscribeHost("d", r.host, h.s);
  for (let i = 0; i < 10; i++) expect(hub.command("d", token, { type: "next" })).toBe("ok");
  expect(hub.command("d", token, { type: "next" })).toBe("rate");
  expect(h.got.filter(([e]) => e === "cmd").length).toBe(10);
  tick(1100);
  expect(hub.command("d", token, { type: "prev" })).toBe("ok");
});

test("상태: 발표자 키만 보낼 수 있고, 휴대폰은 붙자마자 마지막 상태와 접속 여부를 받는다", () => {
  const { hub } = setup();
  const r = hub.start("d")!;
  const { token } = hub.join("d", r.code) as { token: string };
  const st = parseState({ slide: 3, total: 9, title: "t", notes: "n", elapsed: 5, running: true, blank: null, target: 0 })!;
  expect(hub.setState("d", "wrong", st)).toBe(false);
  expect(hub.setState("d", r.host, st)).toBe(true);
  const v = sink();
  expect(hub.subscribeViewer("d", "bad", sink().s)).toBeNull();
  hub.subscribeViewer("d", token, v.s);
  expect(v.got).toEqual([["presence", { online: false }], ["state", st]]);
  const h = sink();
  const off = hub.subscribeHost("d", r.host, h.s)!;
  expect(v.got.at(-1)).toEqual(["presence", { online: true }]);
  off();
  expect(v.got.at(-1)).toEqual(["presence", { online: false }]);
  expect(hub.subscribeHost("d", "wrong", sink().s)).toBeNull();
});

test("종료: stop과 새 start와 2시간 만료가 세션과 토큰을 폐기하고 연결에 end를 보낸다", () => {
  const { hub, tick } = setup();
  let r = hub.start("d")!;
  let { token } = hub.join("d", r.code) as { token: string };
  const v = sink();
  hub.subscribeViewer("d", token, v.s);
  expect(hub.stop("d", "wrong")).toBe(false);
  expect(hub.stop("d", r.host)).toBe(true);
  expect(v.got.at(-1)![0]).toBe("end"); expect(v.closed).toBe(true);
  expect(hub.command("d", token, { type: "next" })).toBe("auth");
  // 새 start는 옛 세션 토큰을 무효로 한다
  tick(31_000);
  r = hub.start("d")!; token = (hub.join("d", r.code) as { token: string }).token;
  tick(31_000); // 발표자 연결이 없고 유예(30초)가 지나야 키 없이 새로 시작할 수 있다
  const r2 = hub.start("d")!;
  expect(hub.command("d", token, { type: "next" })).toBe("auth");
  // 만료
  const j = hub.join("d", r2.code) as { token: string };
  tick(TTL_MS - 1);
  expect(hub.command("d", j.token, { type: "next" })).toBe("offline");
  tick(2);
  expect(hub.command("d", j.token, { type: "next" })).toBe("auth");
  expect(hub.size()).toBe(0);
});

test("start: 발표 중인 세션은 키 없이 가로챌 수 없고, 키가 맞으면 코드만 새로 받으며 휴대폰은 유지된다", () => {
  const { hub, tick } = setup();
  const r = hub.start("d")!;
  const { token } = hub.join("d", r.code) as { token: string };
  const h = sink();
  hub.subscribeHost("d", r.host, h.s);
  expect(hub.start("d")).toBeNull();
  expect(hub.start("d", "wrong")).toBeNull();
  const again = hub.start("d", r.host)!;
  expect(again.host).toBe(r.host);
  expect(again.code).not.toBe(r.code);
  expect(hub.command("d", token, { type: "next" })).toBe("ok"); // 이어 간 세션의 토큰은 그대로 유효
  expect("token" in hub.join("d", again.code)).toBe(true); // 새 코드는 쓸 수 있다
  // 발표자 연결이 끊겨도 유예 동안은 가로챌 수 없다
  const off = hub.subscribeHost("d", r.host, sink().s)!; off();
  hub.subscribeHost("d", "x", sink().s);
  h.s.close();
  tick(10_000);
  expect(hub.start("d")).toBeNull();
});

test("틀린 코드가 한도에 이르면 코드를 폐기하고 발표자에게 locked를 알린다(재발급은 키로)", () => {
  const { hub } = setup();
  const r = hub.start("d")!;
  const h = sink();
  hub.subscribeHost("d", r.host, h.s);
  for (let i = 0; i < 5; i++) hub.join("d", "AAAA-AAAA");
  expect(h.got.some(([e]) => e === "locked")).toBe(true);
  expect(hub.join("d", r.code)).toEqual({ error: "limit" });
  const fresh = hub.start("d", r.host)!;
  expect("token" in hub.join("d", fresh.code)).toBe(true); // 실패 기록도 새 코드와 함께 초기화
});

test("SSE 연결 상한: 세션당 발표자 2개, 휴대폰 4개", () => {
  const { hub } = setup();
  const r = hub.start("d")!;
  const { token } = hub.join("d", r.code) as { token: string };
  expect(hub.subscribeHost("d", r.host, sink().s)).not.toBeNull();
  expect(hub.subscribeHost("d", r.host, sink().s)).not.toBeNull();
  expect(hub.subscribeHost("d", r.host, sink().s)).toBeNull();
  for (let i = 0; i < 4; i++) expect(hub.subscribeViewer("d", token, sink().s)).not.toBeNull();
  expect(hub.subscribeViewer("d", token, sink().s)).toBeNull();
});

test("parseState: 범위 밖 값은 0으로 바꿔 통과시키지 않고 거절한다", () => {
  expect(parseState({ slide: 5, total: 3 })).toBeNull();
  expect(parseState({ slide: 1, total: 10000 })).toBeNull();
  expect(parseState({ slide: 3, total: 3, title: "", notes: "", elapsed: 0, running: false, blank: null, target: 0 })).not.toBeNull();
});

test("티켓: 한 번만 쓰이고, 15초 뒤 만료되고, 다른 세션이나 다른 덱의 티켓은 거절한다", () => {
  const { hub, tick } = setup();
  const r = hub.start("d")!;
  const { token } = hub.join("d", r.code) as { token: string };
  expect(hub.issueTicket("d", "viewer", "bad")).toBeNull();
  expect(hub.issueTicket("d", "host", token)).toBeNull(); // 역할과 자격이 맞아야 한다
  expect(hub.issueTicket("d", "viewer", r.host)).toBeNull();
  expect(hub.issueTicket("nope", "host", r.host)).toBeNull();
  const t1 = hub.issueTicket("d", "viewer", token)!;
  const v = sink();
  expect(hub.attach("d", t1, v.s)).not.toBeNull();
  expect(v.got[0]).toEqual(["presence", { online: false }]);
  expect(hub.attach("d", t1, sink().s)).toBeNull(); // 재사용 거절
  const t2 = hub.issueTicket("d", "host", r.host)!;
  tick(15_001);
  expect(hub.attach("d", t2, sink().s)).toBeNull(); // 만료
  // 다른 덱에는 쓸 수 없고, 쓰려 한 티켓도 소모된다
  const other = hub.start("e")!;
  const t3 = hub.issueTicket("d", "host", r.host)!;
  expect(hub.attach("e", t3, sink().s)).toBeNull();
  expect(hub.attach("d", t3, sink().s)).toBeNull();
  void other;
  // 세션이 새로 시작되면(옛 키 무효) 옛 티켓도 무효
  const t4 = hub.issueTicket("d", "host", r.host)!;
  hub.stop("d", r.host);
  tick(31_000);
  hub.start("d");
  expect(hub.attach("d", t4, sink().s)).toBeNull();
});

test("티켓: 발표자 티켓은 발표자 연결, 휴대폰 티켓은 휴대폰 연결로 열리고 세션당 미사용 20개까지 발급", () => {
  const { hub } = setup();
  const r = hub.start("d")!;
  const { token } = hub.join("d", r.code) as { token: string };
  const h = sink(), v = sink();
  hub.attach("d", hub.issueTicket("d", "host", r.host)!, h.s);
  hub.attach("d", hub.issueTicket("d", "viewer", token)!, v.s);
  expect(v.got.at(-1)).toEqual(["presence", { online: true }]); // 발표자 연결이 보인다
  hub.command("d", token, { type: "next" });
  expect(h.got.some(([e]) => e === "cmd")).toBe(true);
  for (let i = 0; i < 20; i++) expect(hub.issueTicket("d", "viewer", token)).not.toBeNull();
  expect(hub.issueTicket("d", "viewer", token)).toBeNull();
});
