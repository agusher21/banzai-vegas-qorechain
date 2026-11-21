// Capture real Playwright screenshots of the LIVE Banzai Vegas site
// (https://agusher21.github.io/banzai-vegas-qorechain/) + QoreChain
// explorer pages, for the Fest demo video — QOR version.
// Reads are wallet-less (public RPC); the connect click only ever opens
// the wallet picker modal in this headless browser — NO transaction is
// ever sent, NO wallet is connected, NO faucet is claimed.
// Run: NODE_PATH=/home/hatch/workspace/kiroween/tombstone-tasks/node_modules \
//        node capture-qor.js
// (Start proxy.js first: node proxy.js — it reads the egress password
// fresh from the environment; run the capture immediately after.)
const { chromium } = require('playwright');

const SITE = 'https://agusher21.github.io/banzai-vegas-qorechain/';
const OUT = '/home/hatch/workspace/banzai-vegas-qorechain/demo-video/shots-qor';
const RAFFLE = '0x24f9cffaf5334b2bae7a2da0c5fd8e6dffbc291e';
const PQC_TX = '78C826BC8F66912012F64497E820D05E7290DF0749F1CCE4619973F5CC0CB747';
const WINDOW_TX = '054447E3A88312DE9A62BAA0C771EEAEFD6341B265A94A6862810AC2A5650310';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}` });
  console.log('shot', name);
}

(async () => {
  // Network: the VM egresses via an authenticated MITM proxy
  // (hatch-egress-proxy:3128). Chromium cannot use it directly — it waits
  // for a 407 the proxy never sends, and it does not trust the Hatch Egress
  // CA. Route through the local forward proxy (proxy.js, 127.0.0.1:18080),
  // which re-issues requests with preemptive auth like curl does, and ignore
  // cert errors (the proxy re-signs TLS with the Hatch Egress CA; the pages
  // captured are public, no credentials are involved).
  const browser = await chromium.launch({
    executablePath: '/home/hatch/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome',
    proxy: { server: 'http://127.0.0.1:18080' },
    args: ['--ignore-certificate-errors'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('console error:', m.text()); });
  page.on('pageerror', (e) => console.log('pageerror:', String(e)));

  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  // Wait for the on-chain reads to populate (pot amount stops being "—").
  try {
    await page.waitForFunction(
      () => document.getElementById('potAmount')?.textContent?.trim() !== '—',
      { timeout: 60000 });
  } catch (e) { console.log('WARN: pot did not populate in 60s'); }
  await sleep(1500); // let the countdown tick + layout settle
  console.log('pot:', await page.textContent('#potAmount'),
    '| countdown:', await page.textContent('#countdown'),
    '| tickets:', await page.textContent('#ticketsSold'),
    '| players:', await page.textContent('#playerCount'),
    '| drawState:', await page.textContent('#drawState'),
    '| buyBtn:', await page.textContent('#buyBtn'));

  // 01 — opening: hero with pot, countdown, tickets, players, prizes.
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(400);
  await shot(page, '01-hero.png');

  // 02 — ticket picker: pick 5 tickets (25 QOR), buy card in view.
  await page.click('.qty[data-qty="5"]');
  await sleep(400);
  await page.locator('.buy-card').scrollIntoViewIfNeeded();
  await sleep(400);
  await shot(page, '02-picker.png');

  // 03 — faucet / how it works: the #how section (QOR faucet 100/day).
  await page.locator('#how').scrollIntoViewIfNeeded();
  await sleep(400);
  await shot(page, '03-how.png');

  // 04 — buy up to the wallet prompt: click Connect wallet. The app opens
  // the wallet picker modal (MetaMask, QoreX, WalletConnect, ...). No wallet
  // is installed in this browser and NO option is clicked — no tx, no sign.
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(400);
  await page.click('#connectBtn');
  await sleep(700); // modal opens
  const modalOpen = await page.evaluate(() =>
    !document.getElementById('walletModal')?.classList.contains('hidden'));
  console.log('wallet modal open:', modalOpen,
    '| toast:', await page.textContent('#toast'));
  await shot(page, '04-wallet.png');
  // Close the modal so nothing lingers.
  await page.click('#walletModalClose').catch(() => {});

  // --- Explorer (TESTNET) -------------------------------------------------
  // The explorer defaults to MAINNET; our contracts/txs are on TESTNET
  // (qorechain-diana). Click the "Testnet" pill after each navigation —
  // the choice persists in localStorage, and clicking the already-selected
  // pill is a no-op. The /tx/ route also rejects a "0x" prefix, so strip it.
  // NOTE: EVM txs (raffle deploy, startRaffle) are NOT indexed on /tx/ —
  // show the raffle ADDRESS page instead.
  async function explorerShot(url, name, mustContain) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await sleep(3000); // JS app mounts
    try { await page.getByText('Testnet', { exact: true }).first().click({ timeout: 5000 }); } catch (e) { console.log('testnet toggle click skipped:', String(e).split('\n')[0]); }
    try {
      await page.waitForFunction(
        (needle) => document.body.innerText.includes(needle),
        mustContain, { timeout: 20000 });
    } catch (e) { console.log(`WARN: "${mustContain}" did not appear on ${name}`); }
    await sleep(1500);
    await shot(page, name);
  }

  // 05a — explorer: raffle contract account on testnet.
  await explorerShot(`https://explore.qore.network/address/${RAFFLE}`, '05a-raffle-explorer.png', '0x24f9cffaf5334b2b');
  // 05b — explorer: PQC ML-DSA-87 registration tx on testnet.
  await explorerShot(`https://explore.qore.network/tx/${PQC_TX}`, '05b-pqc-tx.png', '78C826BC8F66912012F64497E820D05E7290DF0749F1CCE4619973F5CC0CB747');
  // 05c — explorer: hybrid-signed window-open tx on testnet (native, indexed).
  await explorerShot(`https://explore.qore.network/tx/${WINDOW_TX}`, '05c-window-tx.png', '054447E3A88312DE9A62BAA0C771EEAEFD6341B265A94A6862810AC2A5650310');

  await ctx.close();
  await browser.close();
  console.log('done');
})().catch((e) => { console.error(e); process.exit(1); });
