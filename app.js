// BANZAI VEGAS frontend — reads work without a wallet (public QoreChain testnet (qorechain-diana, EVM 9800)
// RPC); buying / claiming / drawing need MetaMask on QoreChain testnet (9800).
// QOR-native: tickets cost 5 QOR each, paid as native value with the buy
// call; prizes pay out in QOR. No token, no approval step — get QOR from
// the QoreChain faucet (100 QOR/day).
const $ = (id) => document.getElementById(id);
const ZERO = "0x0000000000000000000000000000000000000000";

let readProvider = null;
let signer = null;
let account = null;
let raffle = null;
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
    $("contractLinks").textContent = "QOR raffle not deployed yet — see DEPLOY.md";
    return;
  }
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
      $("drawBtn").disabled = now < drawTime * 1000;
      $("finalizeBtn").disabled = true;
    } else if (raffleState === 1) {
      $("drawState").textContent = "DRAWING — SEED BLOCK " + Number(r.seedBlock);
      $("drawBtn").disabled = true;
      $("finalizeBtn").disabled = false;
    } else {
      $("drawState").textContent = "FINALIZED";
      $("drawBtn").disabled = true;
      $("finalizeBtn").disabled = true;
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
  if (!window.ethereum) { toast("MetaMask not found — install it to play."); return false; }
  if (!account) { toast("Connect your wallet first."); return false; }
  const chainId = await window.ethereum.request({ method: "eth_chainId" });
  if (parseInt(chainId, 16) !== CONFIG.chainId) {
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2648" }] });
    } catch (e) {
      if (e.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{ chainId: "0x2648", chainName: CONFIG.chainName, nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 }, rpcUrls: [CONFIG.rpcUrl], blockExplorerUrls: [CONFIG.blockExplorer] }],
        });
      } else { toast("Please switch MetaMask to QoreChain Testnet."); return false; }
    }
  }
  return true;
}

async function connectWallet() {
  if (!window.ethereum) { toast("MetaMask not found — install it to play."); return; }
  const provider = new ethers.BrowserProvider(window.ethereum);
  const accounts = await provider.send("eth_requestAccounts", []);
  account = accounts[0];
  signer = await provider.getSigner();
  $("connectBtn").textContent = account.slice(0, 6) + "…" + account.slice(-4);
  raffle = raffle.connect(signer);
  await refreshAccount();
  toast("Connected: " + account);
}

async function buy() {
  if (!(await ensureWallet())) return;
  const qty = pickedQty === "max" ? Math.max(0, CONFIG.maxTicketsPerPlayer - myTicketCount) : pickedQty;
  if (!qty) { toast("You already hold the max 20 tickets this round."); return; }
  const cost = ethers.parseEther(String(qty * CONFIG.ticketPriceQOR));
  try {
    toast(`Buying ${qty} ticket(s) for ${qty * CONFIG.ticketPriceQOR} QOR…`);
    const tx = await raffle.buyTickets(qty, { value: cost });
    await tx.wait();
    toast(`Bought ${qty} ticket(s). Good luck!`);
    await refresh();
    const mine = await raffle.getPlayerTickets(raffleId, account);
    showTicketReveal(mine.map(Number));
  } catch (e) { console.error(e); toast("Buy failed: " + (e.reason || e.message || e)); }
}

async function claim() {
  if (!(await ensureWallet())) return;
  try {
    const tx = await raffle.claim(raffleId);
    await tx.wait();
    toast("Prizes claimed in QOR. Congratulations!");
    await refresh();
  } catch (e) { console.error(e); toast("Claim failed: " + (e.reason || e.message || e)); }
}

async function draw() {
  if (!(await ensureWallet())) return;
  try { const tx = await raffle.draw(); await tx.wait(); toast("Draw started — seed block set."); await refresh(); }
  catch (e) { console.error(e); toast("Draw failed: " + (e.reason || e.message || e)); }
}

async function finalize() {
  if (!(await ensureWallet())) return;
  try { const tx = await raffle.finalize(); await tx.wait(); toast("Winners picked — check the list below."); await refresh(); }
  catch (e) { console.error(e); toast("Finalize failed: " + (e.reason || e.message || e)); }
}

document.querySelectorAll(".qty").forEach((b) =>
  b.addEventListener("click", () => { pickedQty = b.dataset.qty === "max" ? "max" : Number(b.dataset.qty); updatePicker(); }));
$("buyBtn").addEventListener("click", buy);
$("claimBtn").addEventListener("click", claim);
$("drawBtn").addEventListener("click", draw);
$("finalizeBtn").addEventListener("click", finalize);
$("connectBtn").addEventListener("click", connectWallet);

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
  setInterval(async () => {
    if (drawTime) $("countdown").textContent = fmtCountdown(drawTime * 1000 - Date.now());
  }, 1000);
  setInterval(refresh, 30000); // re-read chain state every 30s
})();
