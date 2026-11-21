// BANZAI VEGAS frontend — reads work without a wallet (public QoreChain testnet (qorechain-diana, EVM 9800)
// RPC); buying / claiming / drawing need MetaMask on QoreChain testnet (9800).
const $ = (id) => document.getElementById(id);
const ZERO = "0x0000000000000000000000000000000000000000";

let readProvider = null;
let signer = null;
let account = null;
let token = null;
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

function fmtBNZ(v) {
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
      if (d.chainId === CONFIG.chainId && d.token && d.raffle) {
        CONFIG.tokenAddress = d.token;
        CONFIG.raffleAddress = d.raffle;
        deployed = true;
      }
    }
  } catch (e) { /* no deployed-addresses.json yet — use CONFIG placeholders */ }
  if (CONFIG.tokenAddress !== ZERO && CONFIG.raffleAddress !== ZERO) deployed = true;
}

async function refresh() {
  if (!deployed) {
    $("potAmount").textContent = "—";
    $("drawState").textContent = "NOT DEPLOYED YET";
    $("drawInfo").textContent = "Contracts are not deployed on QoreChain yet. See DEPLOY.md in the repo — deployment needs the operator's testnet wallet (faucet-funded).";
    $("contractLinks").textContent = "not deployed yet — see DEPLOY.md";
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
    $("potAmount").textContent = fmtBNZ(r.pot);
    $("ticketsSold").textContent = Number(r.totalTickets).toLocaleString();
    $("playerCount").textContent = Number(r.playerCount).toLocaleString();
    $("nextTicketNo").textContent = String(Number(r.totalTickets) + 1).padStart(4, "0");
    $("prize1").textContent = fmtBNZ((r.pot * 30n) / 100n) + " BNZ";
    $("prize2").textContent = fmtBNZ((r.pot * 18n) / 100n) + " BNZ";
    $("prize3").textContent = fmtBNZ((r.pot * 12n) / 100n) + " BNZ";

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
          `<li>Ticket #${w.ticketId} — ${w.player.slice(0, 6)}…${w.player.slice(-4)} — <strong>${fmtBNZ(w.prize)} BNZ</strong>${w.claimed ? " (claimed)" : ""}</li>`
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
  const bal = await token.balanceOf(account);
  $("myBalance").textContent = fmtBNZ(bal) + " BNZ";
  const mine = await raffle.getPlayerTickets(raffleId, account);
  myTicketCount = mine.length;
  $("youHold").textContent = `YOU HOLD ${myTicketCount} / ${CONFIG.maxTicketsPerPlayer}`;
  $("myTickets").textContent = mine.length ? "#" + mine.map(String).join(", #") : "none yet";
  const claimable = await raffle.claimable(raffleId, account);
  $("claimableAmount").textContent = fmtBNZ(claimable) + " BNZ";
  $("claimBtn").disabled = claimable === 0n;
  updatePicker();
}

function updatePicker() {
  const max = Math.max(0, CONFIG.maxTicketsPerPlayer - myTicketCount);
  if (pickedQty === "max") pickedQty = max;
  if (typeof pickedQty === "number" && pickedQty > max) pickedQty = max;
  const qty = pickedQty === "max" ? max : pickedQty;
  $("pickedQty").textContent = qty;
  $("totalCost").textContent = qty * CONFIG.ticketPriceBNZ;
  document.querySelectorAll(".qty").forEach((b) =>
    b.classList.toggle("selected", String(b.dataset.qty) === String(pickedQty)));
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
  token = token.connect(signer);
  raffle = raffle.connect(signer);
  await refreshAccount();
  toast("Connected: " + account);
}

async function buy() {
  if (!(await ensureWallet())) return;
  const qty = pickedQty === "max" ? Math.max(0, CONFIG.maxTicketsPerPlayer - myTicketCount) : pickedQty;
  if (!qty) { toast("You already hold the max 20 tickets this round."); return; }
  const cost = ethers.parseEther(String(qty * CONFIG.ticketPriceBNZ));
  try {
    const allowance = await token.allowance(account, CONFIG.raffleAddress);
    if (allowance < cost) {
      toast("Step 1/2: approving BNZ spend…");
      const tx1 = await token.approve(CONFIG.raffleAddress, cost);
      await tx1.wait();
    }
    toast(`Step 2/2: buying ${qty} ticket(s)…`);
    const tx2 = await raffle.buyTickets(qty);
    await tx2.wait();
    toast(`Bought ${qty} ticket(s). Good luck!`);
    await refresh();
  } catch (e) { console.error(e); toast("Buy failed: " + (e.reason || e.message || e)); }
}

async function faucet() {
  if (!(await ensureWallet())) return;
  try {
    toast("Claiming 1,000 BNZ from the faucet…");
    const tx = await token.faucet();
    await tx.wait();
    toast("1,000 BNZ claimed. One claim per address per 24h.");
    await refresh();
  } catch (e) { console.error(e); toast("Faucet failed: " + (e.reason || e.message || e)); }
}

async function claim() {
  if (!(await ensureWallet())) return;
  try {
    const tx = await raffle.claim(raffleId);
    await tx.wait();
    toast("Prizes claimed. Congratulations!");
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
$("faucetBtn").addEventListener("click", faucet);
$("claimBtn").addEventListener("click", claim);
$("drawBtn").addEventListener("click", draw);
$("finalizeBtn").addEventListener("click", finalize);
$("connectBtn").addEventListener("click", connectWallet);

(async function init() {
  await loadAddresses();
  readProvider = new ethers.JsonRpcProvider(CONFIG.rpcUrl);
  if (deployed) {
    token = new ethers.Contract(CONFIG.tokenAddress, TOKEN_ABI, readProvider);
    raffle = new ethers.Contract(CONFIG.raffleAddress, RAFFLE_ABI, readProvider);
    $("contractLinks").innerHTML =
      `BNZ <a href="${CONFIG.blockExplorer}/token/${CONFIG.tokenAddress}" target="_blank">${CONFIG.tokenAddress.slice(0, 10)}…</a> · ` +
      `Raffle <a href="${CONFIG.blockExplorer}/address/${CONFIG.raffleAddress}" target="_blank">${CONFIG.raffleAddress.slice(0, 10)}…</a>`;
  }
  await refresh();
  setInterval(async () => {
    if (drawTime) $("countdown").textContent = fmtCountdown(drawTime * 1000 - Date.now());
  }, 1000);
  setInterval(refresh, 30000); // re-read chain state every 30s
})();
