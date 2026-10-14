/* 러너가 단계 전체가 공유할 브라우저 서버를 띄운다. 첫 줄에 WS=<주소>를 찍고 종료 신호까지 살아 있다. */
const { chromium } = require(process.env.PW || 'playwright-core');
(async () => {
  const server = await chromium.launchServer({ executablePath: process.env.CHROME, args: ['--disable-gpu'] });
  console.log('WS=' + server.wsEndpoint());
  const stop = async () => { await server.close().catch(() => {}); process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
})().catch((e) => { console.error(e); process.exit(1); });
