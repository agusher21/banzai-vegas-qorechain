// BANZAI VEGAS frontend — reads work without a wallet (public QoreChain testnet (qorechain-diana, EVM 9800)
// RPC); buying / claiming / drawing need a wallet on QoreChain testnet (9800) —
// pick one from the "Connect wallet" picker (QoreX, MetaMask, WalletConnect,
// Coinbase, Brave, OKX). QoreX is the native QoreChain wallet; its EVM
// provider is window.qorex.evm (it never writes window.ethereum), and
// extension 0.3.x answers eth_requestAccounts but not eth_sendTransaction
// yet — see the QoreX section by the picker. QOR-native: tickets cost 5
// QOR each, paid as
// native value with the buy call; prizes pay out in QOR. No token, no
// approval step — get QOR from the QoreChain faucet (100 QOR/day).
const $ = (id) => document.getElementById(id);
const ZERO = "0x0000000000000000000000000000000000000000";

let readProvider = null;
let signer = null;
let account = null;
let walletProvider = null; // the connected EIP-1193 provider (injected wallet or WalletConnect)
let walletLabel = "";
let raffle = null; // read-only contract on the public RPC — writes connect the signer per call, never reassign this
let raffleId = 0;
let drawTime = 0;
let raffleState = 0; // 0 OPEN, 1 DRAWING, 2 FINALIZED
let pickedQty = 2;
let myTicketCount = 0;
let deployed = false;

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.style.display = "block";
  setTimeout(() => (t.style.display = "none"), 6000);
}

function fmtQOR(v) {
  return Number(ethers.formatEther(v)).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function fmtCountdown(ms) {
  if (ms <= 0) return "closed";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${d}d ${String(h).padStart(2, "0")}h:${String(m).padStart(2, "0")}m:${String(sec).padStart(2, "0")}s`;
}

function drawDateLabel(ts) {
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
  }) + " at 20:00 UTC";
}

async function loadAddresses() {
  // Prefer the deploy script's output when it matches QoreChain.
  try {
    const res = await fetch("deployed-addresses.json");
    if (res.ok) {
      const d = await res.json();
      if (d.chainId === CONFIG.chainId && d.raffle && !d.retired) {
        CONFIG.raffleAddress = d.raffle;
        deployed = true;
      }
    }
  } catch (e) { /* no deployed-addresses.json yet — use CONFIG placeholders */ }
  if (CONFIG.raffleAddress !== ZERO) deployed = true;
}

async function refresh() {
  if (!deployed) {
    $("potAmount").textContent = "—";
    $("drawState").textContent = "NOT DEPLOYED YET";
    $("drawInfo").textContent = "The QOR-native raffle is not deployed on QoreChain yet — the BNZ version was retired 21 Nov 2026 and the QOR redeploy is pending. See DEPLOY.md in the repo.";
    $("nextDrawLabel").textContent = "—";
    $("contractLinks").textContent = "QOR raffle not deployed yet — see DEPLOY.md";
    updateBuyButton();
    return;
  }
  updateBuyButton();
  try {
    raffleId = Number(await raffle.currentRaffleId());
    if (raffleId === 0) {
      $("drawState").textContent = "NO ROUND OPEN";
      return;
    }
    const r = await raffle.getRaffle(raffleId);
    drawTime = Number(r.drawTime);
    raffleState = Number(r.state);
    $("raffleIdLabel").textContent = "#" + raffleId;
    $("drawDateLabel").textContent = drawDateLabel(drawTime);
    $("raffleWeekLabel").textContent = "DRAW " + drawDateLabel(drawTime).toUpperCase();
    $("nextDrawLabel").textContent = drawDateLabel(drawTime);
    $("potAmount").textContent = fmtQOR(r.pot);
    $("ticketsSold").textContent = Number(r.totalTickets).toLocaleString();
    $("playerCount").textContent = Number(r.playerCount).toLocaleString();
    $("nextTicketNo").textContent = String(Number(r.totalTickets) + 1).padStart(4, "0");
    $("prize1").textContent = fmtQOR((r.pot * 30n) / 100n) + " QOR";
    $("prize2").textContent = fmtQOR((r.pot * 18n) / 100n) + " QOR";
    $("prize3").textContent = fmtQOR((r.pot * 12n) / 100n) + " QOR";

    const now = Date.now();
    if (raffleState === 0) {
      $("drawState").textContent = now >= drawTime * 1000 ? "SALES CLOSED — DRAW PENDING" : "OPEN";
    } else if (raffleState === 1) {
      $("drawState").textContent = "DRAWING — SEED BLOCK " + Number(r.seedBlock);
    } else {
      $("drawState").textContent = "FINALIZED";
    }

    // Winners of the latest finalized round (this one if finalized, else the previous).
    const showId = raffleState === 2 ? raffleId : raffleId - 1;
    if (showId >= 1) {
      const winners = await raffle.getWinners(showId);
      if (winners.length) {
        $("winnersList").innerHTML = "<ul>" + winners.map((w) =>
          `<li>Ticket #${w.ticketId} — ${w.player.slice(0, 6)}…${w.player.slice(-4)} — <strong>${fmtQOR(w.prize)} QOR</strong>${w.claimed ? " (claimed)" : ""}</li>`
        ).join("") + "</ul>";
      }
    }

    if (account) await refreshAccount();
  } catch (e) {
    console.error(e);
    $("drawState").textContent = "READ ERROR — check the RPC / addresses";
  }
}

async function refreshAccount() {
  const bal = await readProvider.getBalance(account);
  $("myBalance").textContent = fmtQOR(bal) + " QOR";
  // Pre-deployment there is no raffle contract to read — balance only, so
  // connecting a wallet still works before the QOR redeploy lands.
  if (!deployed || !raffle) {
    $("youHold").textContent = `YOU HOLD 0 / ${CONFIG.maxTicketsPerPlayer}`;
    $("myTickets").textContent = "—";
    $("claimableAmount").textContent = "—";
    $("claimBtn").disabled = true;
    updatePicker();
    return;
  }
  const mine = await raffle.getPlayerTickets(raffleId, account);
  myTicketCount = mine.length;
  $("youHold").textContent = `YOU HOLD ${myTicketCount} / ${CONFIG.maxTicketsPerPlayer}`;
  $("myTickets").textContent = mine.length ? "#" + mine.map(String).join(", #") : "none yet";
  const claimable = await raffle.claimable(raffleId, account);
  $("claimableAmount").textContent = fmtQOR(claimable) + " QOR";
  $("claimBtn").disabled = claimable === 0n;
  updatePicker();
}

function updatePicker() {
  const max = Math.max(0, CONFIG.maxTicketsPerPlayer - myTicketCount);
  if (pickedQty === "max") pickedQty = max;
  if (typeof pickedQty === "number" && pickedQty > max) pickedQty = max;
  const qty = pickedQty === "max" ? max : pickedQty;
  $("pickedQty").textContent = qty;
  $("totalCost").textContent = qty * CONFIG.ticketPriceQOR;
  document.querySelectorAll(".qty").forEach((b) =>
    b.classList.toggle("selected", String(b.dataset.qty) === String(pickedQty)));
}

// The Buy button must not look clickable when there is no raffle to buy
// from. The QOR raffle is not deployed yet, so `raffle` is null and a buy
// would crash on `raffle.connect(...)` — the button is disabled and
// labelled COMING SOON until a deploy lands (refresh() re-checks every
// 30s). The guard in buy()/claim() below is the real protection; this is
// just the visible state.
function updateBuyButton() {
  const btn = $("buyBtn");
  if (!deployed || !raffle) {
    btn.disabled = true;
    btn.textContent = "COMING SOON — NOT DEPLOYED YET";
  } else {
    btn.disabled = false;
    btn.textContent = "BUY TICKETS";
  }
}

// ---- animated ticket reveal -------------------------------------------
// After a successful buy, show the player's tickets as a ticket card that
// flips in, with the draw numbers staggering in one by one.
function showTicketReveal(ticketIds) {
  const card = $("ticketReveal");
  $("revealRaffleNo").textContent = "RAFFLE #" + raffleId;
  $("revealDrawDate").textContent = drawTime ? drawDateLabel(drawTime) : "—";
  $("revealCount").textContent = ticketIds.length;
  $("revealTickets").innerHTML = ticketIds.map((id, i) =>
    `<span class="ticket-chip" style="animation-delay:${0.15 + i * 0.12}s">#${String(id).padStart(4, "0")}</span>`
  ).join("");
  // Restart the flip animation each time it is shown.
  card.classList.remove("hidden", "reveal");
  void card.offsetWidth; // reflow — restarts the CSS animation
  card.classList.add("reveal");
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// Preview mode for screenshots / Toni's correction pass:
//   ?preview=tickets&nums=1,2,3,4,5
// Renders the ticket card with the given draw numbers (real numbers from a
// local Hardhat purchase, or mock data) without needing a wallet or a buy.
function maybePreviewTickets() {
  const params = new URLSearchParams(location.search);
  if (params.get("preview") !== "tickets") return;
  const nums = (params.get("nums") || "1,2,3,4,5").split(",").map((s) => Number(s.trim())).filter(Boolean);
  if (raffleId === 0) raffleId = 1;
  if (!drawTime) drawTime = Math.floor(Date.now() / 1000) + 2 * 86400;
  showTicketReveal(nums);
}

async function ensureWallet() {
  if (!walletProvider || !account) { toast("Connect your wallet first."); return false; }
  const chainId = await walletProvider.request({ method: "eth_chainId" });
  if (parseInt(chainId, 16) !== CONFIG.chainId) {
    try {
      await walletProvider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2648" }] });
    } catch (e) {
      if (e.code === 4902) {
        // QoreX cannot add a chain from a page (wallet_addEthereumChain is
        // not supported yet) — the user must switch networks inside QoreX.
        if (walletLabel === "QoreX") {
          toast("QoreX is on the wrong network — switch QoreX to Testnet inside the wallet, then try again.");
          return false;
        }
        await walletProvider.request({
          method: "wallet_addEthereumChain",
          params: [{ chainId: "0x2648", chainName: CONFIG.chainName, nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 }, rpcUrls: [CONFIG.rpcUrl], blockExplorerUrls: [CONFIG.blockExplorer] }],
        });
      } else { toast("Please switch your wallet to QoreChain Testnet."); return false; }
    }
  }
  return true;
}

// ---- connect-wallet picker --------------------------------------------
// Lists QoreX first, then MetaMask, WalletConnect, Coinbase, Brave and
// OKX. Injected wallets are detected via their provider flags (EIP-5749:
// window.ethereum.providers when several wallets inject at once); QoreX is
// detected separately (window.qorex.evm / EIP-6963) because it never writes
// window.ethereum. A wallet that is not installed gets an install link
// instead of a connect button. WalletConnect is loaded lazily from the
// official SDK (esm.sh build of @walletconnect/ethereum-provider) and needs
// CONFIG.WALLETCONNECT_PROJECT_ID.

// ---- QoreX (native QoreChain wallet) ----------------------------------
// Pattern from Quantum Tip Jar / Quantum Dice (@qorechain/qorex-types
// 0.1.0): QoreX exposes its EVM provider as window.qorex.evm and announces
// it through EIP-6963 (rdns "network.qore.qorex"). QoreX NEVER writes
// window.ethereum, so the window.ethereum scan below cannot see it — it is
// detected separately here. Its EVM provider (extension 0.3.x) answers
// eth_chainId, eth_accounts, eth_requestAccounts and
// wallet_switchEthereumChain (active chain only); every other method —
// including eth_sendTransaction — rejects with
// "QoreX: EVM method <name> not yet supported" (code 4200 in newer builds).
// So QoreX connects and reads fine, but buys/claims need a QoreX release
// that ships EVM sends; until then the buy/claim errors name it plainly
// (see friendlyWalletError) instead of failing cryptically. No bundler is
// needed: the discovery below is the small window/EIP-6963 check from
// qorex-types, inlined.
const QOREX_RDNS = "network.qore.qorex";
const QOREX_DOWNLOAD_URL = "https://chromewebstore.google.com/detail/qorex/cflpnggbnnifibblifgbeobogdpfjpcg";
let qorexEvmProvider = null; // cached provider found by EIP-6963 discovery

function getQorexEvmProvider() {
  if (qorexEvmProvider) return qorexEvmProvider;
  const q = window.qorex;
  if (q && typeof q === "object" && q.evm && typeof q.evm.request === "function") {
    qorexEvmProvider = q.evm;
    return qorexEvmProvider;
  }
  return null;
}

function isQorexInstalled() {
  const q = window.qorex;
  if (!q || typeof q !== "object") return false;
  return getQorexEvmProvider() !== null ||
    (q.native && typeof q.native.getKey === "function" && typeof q.native.signDirect === "function");
}

// EIP-6963 discovery (same shape as @qorechain/qorex-types
// discoverQorexEip1193): ask wallets to announce, keep the one whose
// rdns is QoreX. Used as a fallback when window.qorex.evm is not present
// yet at modal-open time (the extension can announce late).
function discoverQorexEip1193(timeoutMs = 500) {
  return new Promise((resolve) => {
    const onAnnounce = (event) => {
      const detail = event && event.detail;
      if (detail && detail.info && detail.info.rdns === QOREX_RDNS &&
          detail.provider && typeof detail.provider.request === "function") {
        finish(detail.provider);
      }
    };
    const finish = (provider) => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      clearTimeout(timer);
      if (provider) qorexEvmProvider = provider;
      resolve(provider || null);
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    const timer = setTimeout(() => finish(null), Math.max(0, timeoutMs));
    window.dispatchEvent(new Event("eip6963:requestProvider"));
  });
}

function isQorexUnsupportedMethodError(err) {
  if (!err || typeof err !== "object") return false;
  if (err.code === 4200) return true;
  const msg = String(err.message || err.reason || "");
  return /^QoreX: EVM method \S+ not yet supported/.test(msg);
}

// Plain-language version of a wallet error. QoreX's EVM provider does not
// send transactions yet, so a buy/claim through it fails on the wallet's
// side — say so and point at a wallet that can send.
function friendlyWalletError(err) {
  if (isQorexUnsupportedMethodError(err)) {
    return "QoreX can't send EVM transactions yet in this version — connect with MetaMask, Coinbase, Brave or OKX to buy and claim. (QoreX stays connected for viewing.)";
  }
  return err && (err.reason || err.message) ? (err.reason || err.message) : String(err);
}

const WALLETS = [
  { id: "metamask", name: "MetaMask", installUrl: "https://metamask.io/download/", flag: (p) => !!(p && p.isMetaMask) },
  { id: "coinbase", name: "Coinbase Wallet", installUrl: "https://www.coinbase.com/wallet", flag: (p) => !!(p && (p.isCoinbaseWallet || p.isCoinbaseWalletExtension)) },
  { id: "brave", name: "Brave Wallet", installUrl: "https://brave.com/download/", flag: (p) => !!(p && p.isBraveWallet) },
  { id: "okx", name: "OKX Wallet", installUrl: "https://www.okx.com/web3", flag: (p) => !!(p && (p.isOKX || p.isOkxWallet)) },
];

function injectedProviders() {
  const list = [];
  const eth = window.ethereum;
  if (eth) {
    if (Array.isArray(eth.providers)) list.push(...eth.providers);
    else list.push(eth);
  }
  // Some wallets expose a second global besides window.ethereum.
  if (window.okxwallet && !list.includes(window.okxwallet)) list.push(window.okxwallet);
  if (window.coinbaseWalletExtension && !list.includes(window.coinbaseWalletExtension)) list.push(window.coinbaseWalletExtension);
  return list;
}

function detectWallets() {
  const providers = injectedProviders();
  // QoreX first: the native QoreChain wallet. It never injects
  // window.ethereum, so it is detected on its own (window.qorex.evm, or
  // the provider found by EIP-6963 discovery).
  const qorexProvider = getQorexEvmProvider();
  const rows = [{
    id: "qorex", name: "QoreX", installUrl: QOREX_DOWNLOAD_URL,
    provider: qorexProvider, installed: !!qorexProvider, native: true,
  }];
  rows.push(...WALLETS.map((w) => {
    const provider = providers.find((p) => w.flag(p)) || null;
    return { ...w, provider, installed: !!provider };
  }));
  rows.push({
    id: "walletconnect", name: "WalletConnect", installUrl: "",
    provider: null, installed: !!(CONFIG.WALLETCONNECT_PROJECT_ID || "").trim(),
    needsProjectId: !(CONFIG.WALLETCONNECT_PROJECT_ID || "").trim(),
  });
  return rows;
}

function renderWalletList() {
  const list = $("walletList");
  list.innerHTML = "";
  for (const w of detectWallets()) {
    const row = document.createElement("div");
    row.className = "wallet-row";
    let status, statusClass;
    if (w.id === "walletconnect") {
      status = w.needsProjectId ? "Needs a projectId — paste yours in config.js" : "Scan with your mobile wallet";
      statusClass = w.needsProjectId ? "" : "installed";
    } else if (w.id === "qorex") {
      status = w.installed ? "Native QoreChain wallet — Installed" : "Native QoreChain wallet — Not installed";
      statusClass = w.installed ? "installed" : "";
    } else {
      status = w.installed ? "Installed — click Connect" : "Not installed";
      statusClass = w.installed ? "installed" : "";
    }
    const action = w.id === "walletconnect"
      ? (w.needsProjectId
        ? `<button class="btn btn-ghost" data-wallet="walletconnect-setup">Set up</button>`
        : `<button class="btn btn-gold" data-wallet="walletconnect">Connect</button>`)
      : (w.installed
        ? `<button class="btn btn-gold" data-wallet="${w.id}">Connect</button>`
        : `<a class="btn btn-ghost" href="${w.installUrl}" target="_blank" rel="noopener">Install</a>`);
    row.innerHTML = `<div class="wallet-info"><div class="wallet-name">${w.name}</div><div class="wallet-status ${statusClass}">${status}</div></div>${action}`;
    list.appendChild(row);
  }
}

function openWalletModal() {
  renderWalletList();
  $("walletModal").classList.remove("hidden");
  // The QoreX extension can announce itself (EIP-6963) after the modal
  // opens; re-render if it shows up and the direct check missed it.
  if (!getQorexEvmProvider()) {
    discoverQorexEip1193().then((p) => {
      if (p && !$("walletModal").classList.contains("hidden")) renderWalletList();
    });
  }
}

function closeWalletModal() {
  $("walletModal").classList.add("hidden");
}

async function connectInjected(provider, label) {
  try {
    const ethersProvider = new ethers.BrowserProvider(provider);
    const accounts = await ethersProvider.send("eth_requestAccounts", []);
    account = accounts[0];
    signer = await ethersProvider.getSigner();
    walletProvider = provider;
    walletLabel = label;
    $("connectBtn").textContent = account.slice(0, 6) + "…" + account.slice(-4);
    closeWalletModal();
    await refreshAccount();
    toast("Connected with " + label + ": " + account);
  } catch (e) {
    console.error(e);
    toast("Connect failed: " + friendlyWalletError(e));
  }
}

async function connectQorex() {
  const provider = getQorexEvmProvider();
  if (!provider) {
    toast("QoreX is not installed — install it from the Chrome Web Store, then try again.");
    return;
  }
  try {
    const ethersProvider = new ethers.BrowserProvider(provider);
    const accounts = await ethersProvider.send("eth_requestAccounts", []);
    account = accounts[0];
    signer = await ethersProvider.getSigner();
    walletProvider = provider;
    walletLabel = "QoreX";
    $("connectBtn").textContent = account.slice(0, 6) + "…" + account.slice(-4);
    closeWalletModal();
    await refreshAccount();
    toast("Connected with QoreX: " + account);
  } catch (e) {
    console.error(e);
    toast("Connect failed: " + friendlyWalletError(e));
  }
}

async function connectWalletConnect() {
  const pid = (CONFIG.WALLETCONNECT_PROJECT_ID || "").trim();
  if (!pid) {
    toast("WalletConnect needs a projectId — paste yours in config.js (WALLETCONNECT_PROJECT_ID).");
    return;
  }
  try {
    toast("Loading WalletConnect…");
    const { EthereumProvider } = await import("https://esm.sh/@walletconnect/ethereum-provider@2.26.0");
    const wc = await EthereumProvider.init({
      projectId: pid,
      chains: [CONFIG.chainId],
      rpcMap: { [CONFIG.chainId]: CONFIG.rpcUrl },
      showQrModal: true,
      metadata: {
        name: "BANZAI VEGAS",
        description: "On-chain raffle on QoreChain testnet — 5 QOR a ticket.",
        url: location.origin,
        icons: [location.origin + "/cover.png"],
      },
    });
    const accounts = await wc.enable();
    if (!accounts.length) { toast("WalletConnect: no account selected."); return; }
    const ethersProvider = new ethers.BrowserProvider(wc);
    account = accounts[0];
    signer = await ethersProvider.getSigner();
    walletProvider = wc;
    walletLabel = "WalletConnect";
    $("connectBtn").textContent = account.slice(0, 6) + "…" + account.slice(-4);
    closeWalletModal();
    await refreshAccount();
    toast("Connected with WalletConnect: " + account);
  } catch (e) {
    console.error(e);
    toast("WalletConnect failed: " + (e.message || e));
  }
}

$("walletList").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-wallet]");
  if (!btn) return;
  const id = btn.dataset.wallet;
  if (id === "walletconnect") { connectWalletConnect(); return; }
  if (id === "walletconnect-setup") {
    toast("WalletConnect needs a projectId — paste yours in config.js (WALLETCONNECT_PROJECT_ID).");
    return;
  }
  if (id === "qorex") { connectQorex(); return; }
  const row = detectWallets().find((w) => w.id === id);
  if (row && row.provider) connectInjected(row.provider, row.name);
});
$("walletModalClose").addEventListener("click", closeWalletModal);
$("walletModal").addEventListener("click", (e) => { if (e.target === $("walletModal")) closeWalletModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeWalletModal(); });

// Preview mode for screenshots: ?wallet=1 opens the picker on load.
function maybePreviewWallet() {
  const params = new URLSearchParams(location.search);
  if (params.get("wallet") === "1") openWalletModal();
}

async function buy() {
  // No raffle contract yet (QOR redeploy pending) — `raffle` is null, so
  // calling raffle.connect(...) would crash. Say so plainly and do not
  // attempt the transaction (and do not ask for a wallet first — the
  // missing deployment is the blocker, not the wallet).
  if (!deployed || !raffle) { toast("Raffle belum di-deploy — coming soon"); return; }
  if (!(await ensureWallet())) return;
  const qty = pickedQty === "max" ? Math.max(0, CONFIG.maxTicketsPerPlayer - myTicketCount) : pickedQty;
  if (!qty) { toast("You already hold the max 20 tickets this round."); return; }
  const cost = ethers.parseEther(String(qty * CONFIG.ticketPriceQOR));
  try {
    toast(`Buying ${qty} ticket(s) for ${qty * CONFIG.ticketPriceQOR} QOR…`);
    const tx = await raffle.connect(signer).buyTickets(qty, { value: cost });
    await tx.wait();
    toast(`Bought ${qty} ticket(s). Good luck!`);
    await refresh();
    const mine = await raffle.getPlayerTickets(raffleId, account);
    showTicketReveal(mine.map(Number));
  } catch (e) { console.error(e); toast("Buy failed: " + friendlyWalletError(e)); }
}

async function claim() {
  // Same guard as buy(): no raffle contract yet, so there is nothing to
  // claim from — say so instead of crashing on raffle.connect(...).
  if (!deployed || !raffle) { toast("Raffle belum di-deploy — coming soon"); return; }
  if (!(await ensureWallet())) return;
  try {
    const tx = await raffle.connect(signer).claim(raffleId);
    await tx.wait();
    toast("Prizes claimed in QOR. Congratulations!");
    await refresh();
  } catch (e) { console.error(e); toast("Claim failed: " + friendlyWalletError(e)); }
}

document.querySelectorAll(".qty").forEach((b) =>
  b.addEventListener("click", () => { pickedQty = b.dataset.qty === "max" ? "max" : Number(b.dataset.qty); updatePicker(); }));
$("buyBtn").addEventListener("click", buy);
$("claimBtn").addEventListener("click", claim);
$("connectBtn").addEventListener("click", openWalletModal);

(async function init() {
  await loadAddresses();
  readProvider = new ethers.JsonRpcProvider(CONFIG.rpcUrl);
  if (deployed) {
    raffle = new ethers.Contract(CONFIG.raffleAddress, RAFFLE_ABI, readProvider);
    $("contractLinks").innerHTML =
      `Raffle <a href="${CONFIG.blockExplorer}/address/${CONFIG.raffleAddress}" target="_blank">${CONFIG.raffleAddress.slice(0, 10)}…</a> · QOR-native — tickets &amp; payouts in QOR`;
  }
  await refresh();
  maybePreviewTickets();
  maybePreviewWallet();
  setInterval(async () => {
    if (drawTime) $("countdown").textContent = fmtCountdown(drawTime * 1000 - Date.now());
  }, 1000);
  setInterval(refresh, 30000); // re-read chain state every 30s
})();
