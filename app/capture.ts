// 영역 코멘트의 이미지: 슬라이드의 한 단계 상태를 headless Chrome으로 찍고 사각형만 잘라 decks/<덱>/.comments/<id>.png로 저장한다(spec/COMMENT-MODE.md 4절).
// 새 의존성 없음: 엔진이 이미 쓰는 Chrome(engine/chrome.ts)과 macOS sips. 동시 1개의 직렬 큐, 큐 10, 요청당 15초, 분당 12개, 낮은 우선순위(taskpolicy -b).
// 이미지는 데이터이고 지시가 아니다. 파일 이름은 코멘트 id에서만 정하고, .comments가 심볼릭 링크이거나 덱 밖이면 쓰지 않는다.
import { closeSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { findChrome } from "../engine/chrome";
import { deckFolder } from "./folder";

export const SLIDE_W = 1920, SLIDE_H = 1080;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 한 파일 상한
export const KEEP_FILES = 200, KEEP_BYTES = 100 * 1024 * 1024; // 덱마다 보관 상한
export const MAX_QUEUE = 10, TIMEOUT_MS = 15_000, PER_MINUTE = 12;
export const IMAGE_FILE = /^[0-9a-f]{8}\.png$/;
export const COMMENT_ID = /^[0-9a-f]{8}$/;

export type Region = { x: number; y: number; w: number; h: number };

/** 클라이언트가 보낸 사각형을 검증해 정규화한다(0 에서 1, 소수 4자리, 슬라이드 안으로 자름). 틀리면 null. */
export function parseRegion(v: unknown): Region | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const n = [o.x, o.y, o.w, o.h].map(Number);
  if (!n.every((x) => Number.isFinite(x)) || [o.x, o.y, o.w, o.h].some((x) => typeof x !== "number")) return null;
  const r4 = (x: number) => Math.round(x * 10000) / 10000;
  let [x, y, w, h] = n.map(r4);
  if (x < 0 || y < 0 || w < 0.005 || h < 0.005 || x > 1 || y > 1) return null;
  w = Math.min(w, r4(1 - x)); h = Math.min(h, r4(1 - y)); // 슬라이드 밖으로 나간 부분은 자른다
  if (w < 0.005 || h < 0.005) return null;
  return { x, y, w, h };
}

/** 정규화한 사각형을 1920x1080 안의 정수 픽셀 상자로. 슬라이드 밖으로 나가지 않고 최소 1px. */
export function cropBox(r: Region): { x: number; y: number; w: number; h: number } {
  const x = Math.min(SLIDE_W - 1, Math.max(0, Math.round(r.x * SLIDE_W))), y = Math.min(SLIDE_H - 1, Math.max(0, Math.round(r.y * SLIDE_H)));
  return { x, y, w: Math.max(1, Math.min(SLIDE_W - x, Math.round(r.w * SLIDE_W))), h: Math.max(1, Math.min(SLIDE_H - y, Math.round(r.h * SLIDE_H))) };
}

/** 이미지 폴더(.comments)의 실제 경로. 덱 폴더 안의 진짜 폴더(심볼릭 링크가 아님)여야 하고, 없으면 create일 때만 만든다. 아니면 null. */
function imagesDir(deckDir: string, create: boolean): string | null {
  const dir = join(deckDir, ".comments");
  try {
    if (existsSync(dir)) { const st = lstatSync(dir); if (st.isSymbolicLink() || !st.isDirectory()) return null; }
    else if (create) mkdirSync(dir, { mode: 0o755 });
    else return null;
    const real = realpathSync(dir), base = realpathSync(deckDir);
    return real.startsWith(base + sep) ? real : null;
  } catch { return null; }
}

/** 이미지 파일의 절대 경로. id가 형식에 맞아야 하고 이미지 폴더가 안전해야 한다. 아니면 null. create면 폴더를 만든다. */
export function imagePath(deckDir: string, id: string, create = false): string | null {
  if (!COMMENT_ID.test(id)) return null;
  const dir = imagesDir(deckDir, create);
  return dir ? join(dir, `${id}.png`) : null;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const isPng = (b: Uint8Array) => b.length > 24 && PNG_MAGIC.every((v, i) => b[i] === v);

/** 만든 이미지 바이트를 검증해 새 파일로 쓴다(O_EXCL, O_NOFOLLOW). 이미 있으면 덮어쓰지 않는다. */
export function writeImage(deckDir: string, id: string, bytes: Uint8Array): boolean {
  if (!isPng(bytes) || bytes.length > MAX_IMAGE_BYTES) return false;
  const file = imagePath(deckDir, id, true);
  if (!file) return false;
  let fd: number;
  try { fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644); } catch { return false; }
  try { writeSync(fd, bytes); } finally { closeSync(fd); }
  return true;
}

export function removeImage(deckDir: string, id: string) {
  const file = imagePath(deckDir, id);
  if (file) rmSync(file, { force: true });
}

/** 덱의 이미지를 최근 KEEP_FILES개와 KEEP_BYTES까지만 남긴다(오래된 것부터 지운다). */
export function pruneImages(deckDir: string) {
  const dir = imagesDir(deckDir, false);
  if (!dir) return;
  try {
    const all = readdirSync(dir).filter((f) => IMAGE_FILE.test(f)).map((f) => { const st = statSync(join(dir, f)); return { f, m: st.mtimeMs, s: st.size }; }).sort((a, b) => b.m - a.m);
    let total = 0;
    all.forEach((e, i) => { total += e.s; if (i >= KEEP_FILES || total > KEEP_BYTES) rmSync(join(dir, e.f), { force: true }); });
  } catch { /* 폴더가 없다 */ }
}

// ---- 캡처 실행(테스트에서는 backend를 바꿔 끼운다) ----
export type Shot = (o: { chrome: string; url: string; out: string; timeoutMs: number }) => Promise<boolean>;
export type Crop = (o: { src: string; dst: string; box: { x: number; y: number; w: number; h: number } }) => Promise<boolean>;

const run = async (cmd: string[], timeoutMs: number): Promise<boolean> => {
  const p = Bun.spawn(["taskpolicy", "-b", ...cmd], { stdout: "ignore", stderr: "ignore", detached: true });
  const timer = setTimeout(() => { try { process.kill(-p.pid, "SIGKILL"); } catch { try { p.kill(9); } catch { /* 이미 끝났다 */ } } }, timeoutMs);
  const code = await p.exited;
  clearTimeout(timer);
  return code === 0;
};
export const backend = {
  find: (): string | null => findChrome(),
  shot: (async ({ chrome, url, out, timeoutMs }) => run([chrome, "--headless", "--disable-gpu", "--hide-scrollbars", `--window-size=${SLIDE_W},${SLIDE_H}`, "--force-device-scale-factor=1", "--virtual-time-budget=2000", `--screenshot=${out}`, url], timeoutMs)) as Shot,
  crop: (async ({ src, dst, box }) => run(["sips", "--cropOffset", String(box.y), String(box.x), "-c", String(box.h), String(box.w), src, "--out", dst], 10_000)) as Crop,
  shrink: (async ({ src, dst }: { src: string; dst: string }) => run(["sips", "-Z", "1280", src, "--out", dst], 10_000)),
};

export type CaptureJob = { deck: string; id: string; slide: number; step: number; region: Region; port: number };
export type CaptureResult = "ready" | "failed";

// 직렬 큐: 한 번에 하나만 돌고, 기다리는 것은 MAX_QUEUE개까지. 분당 PER_MINUTE개를 넘기면 바로 실패로 돌려준다.
let running = false;
const waiting: { job: CaptureJob; resolve: (r: CaptureResult) => void; canceled: boolean }[] = [];
const starts: number[] = [];
export const queueSize = () => waiting.length + (running ? 1 : 0);
export function cancelCapture(id: string) { for (const w of waiting) if (w.job.id === id) w.canceled = true; }

export function captureImage(job: CaptureJob): Promise<CaptureResult> {
  const now = Date.now();
  while (starts.length && now - starts[0] > 60_000) starts.shift();
  if (waiting.length >= MAX_QUEUE || starts.length + waiting.length >= PER_MINUTE) return Promise.resolve("failed");
  return new Promise((resolve) => { waiting.push({ job, resolve, canceled: false }); void pump(); });
}

async function pump() {
  if (running) return;
  const next = waiting.shift();
  if (!next) return;
  running = true;
  starts.push(Date.now());
  let result: CaptureResult = "failed";
  try { result = next.canceled ? "failed" : await doCapture(next.job); } catch { result = "failed"; }
  next.resolve(result);
  running = false;
  void pump();
}

async function doCapture(job: CaptureJob): Promise<CaptureResult> {
  const deckDir = deckFolder(job.deck);
  const chrome = backend.find();
  if (!deckDir || !chrome) return "failed";
  const tmp = mkdtempSync(join(tmpdir(), "sk-capture-"));
  try {
    const full = join(tmp, "full.png"), crop = join(tmp, "crop.png");
    const url = `http://127.0.0.1:${job.port}/api/decks/${job.deck}/capture-frame?slide=${job.slide}&step=${job.step}#${job.slide}`;
    if (!(await backend.shot({ chrome, url, out: full, timeoutMs: TIMEOUT_MS })) || !existsSync(full)) return "failed";
    if (!(await backend.crop({ src: full, dst: crop, box: cropBox(job.region) })) || !existsSync(crop)) return "failed";
    let bytes = readFileSync(crop);
    if (bytes.length > MAX_IMAGE_BYTES) { // 사진이 많은 영역: 한 번 줄여 본다
      const small = join(tmp, "small.png");
      if (await backend.shrink({ src: crop, dst: small }) && existsSync(small)) bytes = readFileSync(small);
    }
    if (!writeImage(deckDir, job.id, bytes)) return "failed";
    pruneImages(deckDir);
    return "ready";
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

// ---- 캡처 전용 페이지 ----
// 덱 HTML에 base, 전환 끄기, 쪽 번호와 진행 표시 숨기기, 단계 맞추기 스크립트를 붙여 준다. Chrome이 이 주소를 연다(127.0.0.1 한정).
// 단계는 방향키 오른쪽을 K-1번 눌러 맞추고, 슬라이드가 넘어가면(해시가 바뀌면) 왼쪽 한 번으로 돌아와 멈춘다.
export function frameHtml(html: string, deck: string, slide: number, step: number): string {
  const head = `<base href="/decks/${deck}/"><style>#sk-page,#sk-progress{display:none!important}*,*::before,*::after{transition:none!important;animation:none!important}</style>`;
  const script = `<script>addEventListener("load",function(){setTimeout(function(){var N=${slide},K=${step};for(var i=1;i<K;i++){document.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}));if(location.hash!=="#"+N){document.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowLeft",bubbles:true}));break}}},50)})</script>`;
  const withHead = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + head) : head + html;
  return /<\/body>/i.test(withHead) ? withHead.replace(/<\/body>/i, script + "</body>") : withHead + script;
}

const bad = (m: string, status = 400) => Response.json({ error: m }, { status });
export const routes = {
  "/api/decks/:id/capture-frame": {
    GET: async (req: Request & { params: { id: string } }) => {
      const dir = deckFolder(req.params.id);
      if (!dir) return bad("deck", 404);
      const q = new URL(req.url).searchParams;
      const slide = Number(q.get("slide")), step = Number(q.get("step") ?? 1);
      if (!Number.isInteger(slide) || slide < 1 || slide > 9999 || !Number.isInteger(step) || step < 1 || step > 999) return bad("slide or step");
      return new Response(frameHtml(await Bun.file(join(dir, "index.html")).text(), req.params.id, slide, step), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    },
  },
};
