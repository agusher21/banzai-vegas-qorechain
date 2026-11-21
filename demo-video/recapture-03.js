// Re-capture shot 03 only: scroll #how to just below the sticky nav so the
// HOW IT WORKS card is fully framed (the first pass left the previous
// section's tail cut off at the top). Same proxy setup as capture-qor.js.
// Run: NODE_PATH=/home/hatch/workspace/kiroween/tombstone-tasks/node_modules \
//        node recapture-03.js   (start proxy.js first)
const { chromium } = require('playwright');

const SITE = 'https://agusher21.github.io/banzai-vegas-qorechain/';
const OUT = '/home/hatch/workspace/banzai-vegas-qorechain/demo-video/shots-qor/03-how.png';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({
    executablePath: '/home/hatch/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome',
    proxy: { server: 'http://127.0.0.1:18080' },
    args: ['--ignore-certificate-errors'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror:', String(e)));
  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(
      () => document.getElementById('potAmount')?.textContent?.trim() !== '—',
      { timeout: 60000 });
  } catch (e) { console.log('WARN: pot did not populate in 60s'); }
  await sleep(1200);
  // Put #how just below the sticky nav (~90px), so the card + footer fit cleanly.
  await page.evaluate(() => {
    document.getElementById('how').scrollIntoView({ block: 'start' });
    window.scrollBy(0, -90);
  });
  await sleep(500);
  await page.screenshot({ path: OUT });
  console.log('re-shot 03-how.png');
  await ctx.close();
  await browser.close();
  console.log('done');
})().catch((e) => { console.error(e); process.exit(1); });
