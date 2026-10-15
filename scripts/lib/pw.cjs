/* 공용 Playwright 도우미. 러너(scripts/test.ts)가 브라우저 서버를 한 번 띄우고 SLIDEKIT_PW_WS로 알려 준다.
   1) const { launch, clock, tick } = require('../../scripts/lib/pw.cjs'); const browser = await launch();  // chromium.launch 대신. 서버가 없으면 직접 launch로 폴백
      테스트마다 browser.newContext()를 새로 만들어 격리한다(컨텍스트 생성은 ms 단위). browser.close()는 연결만 끊는다.
   2) 시간 대기: await clock(page) 뒤(보통 goto 전, 열린 뒤에도 된다) 시간은 실제 속도로 흐르고, await tick(page, ms)가 그만큼 앞으로 뛰며
      그 사이의 setTimeout과 setInterval을 순서대로 실행한다. 2초 타이머도 실시간으로 기다리지 않는다. CSS 전환과 애니메이션은 실제 시간이다.
   3) 실패 트레이스: 러너가 SLIDEKIT_TRACE_DIR을 주면 모든 컨텍스트에 tracing을 켜고 닫을 때 <단계>-trace-<n>.zip으로 저장한다(성공하면 러너가 지운다).
      보기: node <playwright-core>/cli.js show-trace <zip> (러너 요약에 명령이 나온다).
   채택 시 주의(공용 서버에 connect하는 방식의 차이):
   - 다운로드: download.path()는 원격 연결에서 쓸 수 없다('Path is not available when connecting remotely'). download.saveAs(경로)로 저장한 파일을 읽는다.
   - 파일 경로: 브라우저는 서버 쪽 프로세스라 테스트 프로세스의 파일을 경로로 직접 열지 못하는 API가 있다. 업로드는 setInputFiles에 {name, mimeType, buffer}를 주는 것이 안전하다.
   - launch 인자: args, executablePath, headless 같은 브라우저 수준 옵션은 서버를 띄울 때 고정이다(scripts/lib/pw-server.cjs). 테스트별로 바꿀 수 없고 launch(opts)의 opts는 폴백 launch에서만 적용된다.
   - 컨텍스트 수준 옵션(viewport, reducedMotion, permissions, geolocation, route 등)은 browser.newContext(옵션)로 그대로 쓴다.
   - browser.close()는 연결만 끊고 서버는 러너가 끝낼 때까지 산다. 브라우저 프로세스 수준의 상태(다른 테스트의 쿠키)는 컨텍스트로 격리된다. */
const path = require('path');

async function launchBase(opts = {}) {
  const { chromium } = require(process.env.PW || 'playwright-core');
  const ws = process.env.SLIDEKIT_PW_WS;
  const browser = ws ? await chromium.connect(ws) : await chromium.launch({ executablePath: process.env.CHROME, args: ['--disable-gpu'], ...opts });
  const dir = process.env.SLIDEKIT_TRACE_DIR;
  if (!dir) return browser;
  const name = process.env.SLIDEKIT_TRACE_NAME || 'run';
  let n = 0;
  const live = new Map();
  const save = async (ctx) => {
    const id = live.get(ctx); if (!id) return; live.delete(ctx);
    await ctx.tracing.stop({ path: path.join(dir, `${name}-trace-${id}.zip`) }).catch(() => {});
  };
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (o) => {
    const ctx = await newContext(o);
    await ctx.tracing.start({ screenshots: true, snapshots: true }).catch(() => {});
    live.set(ctx, ++n);
    const close = ctx.close.bind(ctx);
    ctx.close = async (...a) => { await save(ctx); return close(...a); };
    return ctx;
  };
  const close = browser.close.bind(browser);
  browser.close = async (...a) => { for (const ctx of [...live.keys()]) await save(ctx); return close(...a); };
  return browser;
}

/** 부하 재현: CPU_SLOW=4처럼 주면 이 브라우저가 여는 모든 페이지(팝업 포함)의 CPU를 그 배수로 늦춘다. 느린 기계나 게이트에서 조건 대기가 버티는지 미리 보는 용도다. */
async function launch(opts = {}) {
  const browser = await launchBase(opts);
  const rate = Number(process.env.CPU_SLOW);
  if (!(rate > 1)) return browser;
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (o) => {
    const ctx = await newContext(o);
    ctx.on('page', async (page) => { const cdp = await ctx.newCDPSession(page).catch(() => null); if (cdp) await cdp.send('Emulation.setCPUThrottlingRate', { rate }).catch(() => {}); });
    return ctx;
  };
  return browser;
}

/** goto 전에 부른다. 이 페이지의 시간이 멈추고 tick으로만 흐른다. */
const clock = (page) => page.clock.install();
/** 가짜 시간을 ms만큼 흘린다(그 사이 도래하는 타이머를 순서대로 모두 실행). */
const tick = (page, ms) => page.clock.runFor(ms);

module.exports = { launch, clock, tick };
