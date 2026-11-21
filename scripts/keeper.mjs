// BANZAI VEGAS (QoreChain) — auto-draw keeper.
//   node scripts/keeper.mjs [--dry-run]
//
// Runs the daily draw cycle for the deployed BanzaiRaffle (raffle address
// from deployment.json). Toni picked DAILY 20:00 UTC automatic draws.
//   OPEN + drawTime passed  -> draw()      (records seedBlock)
//   DRAWING + seed mined    -> finalize()  (within the 256-block window)
//   DRAWING + window missed -> draw() again (fresh seed), then finalize()
//   FINALIZED               -> startRaffle(prev drawTime + 24h)
// A single run does the FULL cycle: draw -> finalize -> start the next
// round. 0 tickets: finalize() is safe (no winners, pot rolls over) —
// no special case needed.
// Idempotent: the keeper re-reads on-chain state before every step, so a
// re-run is a no-op or completes the next step — never a duplicate draw
// or a duplicate round.
//
// EVM WINDOW (the part that bites): EVM txs from the operator need a live
// EVM window (hybrid-opened). The keeper reuses a usable live window when
// one exists (then it sends NO native tx at all, like deploy --evm-only);
// otherwise it opens a LONG window (3600 blocks / 10 txs / 2 QOR) with a
// hybrid-signed MsgOpenEVMWindow and waits for it to age in via an
// estimation probe (retry up to 15 min — the deploy lesson: a native tx
// in the same run breaks EVM estimation for a while; the finalize window
// only starts AFTER draw() lands, so the aging wait never eats into it).
// Block time here is ~1.4s, so 3600 blocks ~= 86 min and the 256-block
// finalize window ~= 6 min. The keeper finalizes as soon as the seed
// block is mined, well inside the window.
//
// The operator key comes from .env.local only and is never printed.
// The keeper NEVER touches any wallet but the operator.
import { openEvmWindowMsg } from "@qorechain/sdk";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import {
  EVM_CHAIN_ID,
  EVM_RPC_URL,
  deriveOperator,
  explorerAddressUrl,
  explorerTxUrl,
  getBalanceUqor,
  getEvmWindow,
  getPqcStatus,
  loadEnvFile,
  qorToUqor,
  uqorToQor,
} from "./qore-common.mjs";
import { makeEthClient } from "./qore-eth.mjs";

const DRY_RUN = process.argv.includes("--dry-run");
const RAFFLE = JSON.parse(
  readFileSync(new URL("../deployment.json", import.meta.url), "utf8"),
).raffle;
const WINDOW = { blocks: 3600, maxTxs: 10, maxValueQor: "2" };
const REUSE = { minBlocks: 300, minTxs: 3, minValueQor: "1" };
const DAY_SECONDS = 86400n;
const FINALIZE_WINDOW_BLOCKS = 255n; // finalize needs block.number <= seedBlock + 255
const EST_RETRY_MS = 15 * 60 * 1000; // estimation probe retry budget (deploy lesson)
const EST_RETRY_DELAY_MS = 10_000;
const SEED_POLL_MS = 2000;
const RECEIPT_TIMEOUT_MS = 120_000;

const STATE_NAMES = ["OPEN", "DRAWING", "FINALIZED"];

const qoreEvmChain = defineChain({
  id: EVM_CHAIN_ID,
  name: "QoreChain Testnet EVM",
  nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: { default: { http: [EVM_RPC_URL] } },
  blockExplorers: { default: { name: "QoreChain Explorer", url: "https://explore.qore.network" } },
});

function ts() {
  return new Date().toISOString();
}
function log(msg) {
  console.log(`[${ts()}] ${msg}`);
}
function fail(message) {
  console.error(`\n[${ts()}] FATAL: ${message}`);
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadArtifact(contractName) {
  return JSON.parse(
    readFileSync(
      new URL(
        `../artifacts/contracts/${contractName}.sol/${contractName}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
}

const env = loadEnvFile();
const { unified } = await deriveOperator(env);
const operator = unified.cosmos;
const raffleArtifact = loadArtifact("BanzaiRaffle");
const raffleAbi = raffleArtifact.abi;

const publicClient = createPublicClient({
  chain: qoreEvmChain,
  transport: http(EVM_RPC_URL),
});
const account = privateKeyToAccount(unified.privateKey);
const wallet = createWalletClient({
  account,
  chain: qoreEvmChain,
  transport: http(EVM_RPC_URL),
});

log(`BANZAI VEGAS keeper${DRY_RUN ? " (DRY RUN — read-only, no txs)" : ""} — raffle ${RAFFLE} operator ${operator} (EVM ${unified.evm})`);

/** Read the full on-chain picture in one go. */
async function readState() {
  const [blockNumber, raffleId, owner] = await Promise.all([
    publicClient.getBlockNumber(),
    publicClient.readContract({ address: RAFFLE, abi: raffleAbi, functionName: "currentRaffleId" }),
    publicClient.readContract({ address: RAFFLE, abi: raffleAbi, functionName: "owner" }),
  ]);
  const r = await publicClient.readContract({
    address: RAFFLE,
    abi: raffleAbi,
    functionName: "raffles",
    args: [raffleId],
  });
  // raffles tuple: (drawTime, pot, totalTickets, playerCount, seedBlock, state)
  const raffle = {
    drawTime: BigInt(r[0]),
    pot: BigInt(r[1]),
    totalTickets: BigInt(r[2]),
    playerCount: BigInt(r[3]),
    seedBlock: BigInt(r[4]),
    state: Number(r[5]),
  };
  const block = await publicClient.getBlock({ blockNumber });
  return {
    blockNumber,
    now: BigInt(block.timestamp),
    raffleId: BigInt(raffleId),
    owner,
    raffle,
  };
}

function describeState(s) {
  const r = s.raffle;
  return (
    `raffle #${s.raffleId} state=${STATE_NAMES[r.state]} ` +
    `drawTime=${r.drawTime} (${new Date(Number(r.drawTime) * 1000).toISOString()}) ` +
    `pot=${uqorToQor(r.pot / 1_000_000_000_000n)} QOR ` +
    `tickets=${r.totalTickets} players=${r.playerCount} seedBlock=${r.seedBlock} ` +
    `block=${s.blockNumber} now=${s.now}`
  );
}

/** Next draw: previous drawTime + 24h, advanced by whole days until future. */
function nextDrawTime(prevDrawTime, now) {
  let next = prevDrawTime + DAY_SECONDS;
  while (next <= now) next += DAY_SECONDS;
  return next;
}

// --- Preflight: balance + PQC (read-only, runs in dry-run too) -----------
const balance = await getBalanceUqor(operator);
log(`Operator balance: ${uqorToQor(balance)} QOR`);
if (balance === 0n) {
  fail(`operator unfunded — claim the faucet first (100 QOR to ${operator}), then re-run.`);
}
const pqc = await getPqcStatus(operator);
if (!pqc.registered) {
  fail("operator PQC key not registered — run node scripts/register-operator.mjs first.");
}
log(`PQC key registered (algorithm ${pqc.algorithmId ?? "?"}).`);

let state = await readState();
if (state.owner.toLowerCase() !== unified.evm.toLowerCase()) {
  fail(`raffle owner is ${state.owner}, not the operator ${unified.evm} — refusing to run.`);
}
log(`State: ${describeState(state)}`);

// --- Decide what this run must do -----------------------------------------
// plan: list of steps, each { action: "draw" | "finalize" | "startRaffle" }
function planFor(s) {
  const r = s.raffle;
  const steps = [];
  if (r.state === 0) {
    // OPEN
    if (s.now < r.drawTime) return steps; // draw not due — nothing to do
    steps.push({ action: "draw", raffleId: s.raffleId });
    steps.push({ action: "finalize", raffleId: s.raffleId });
    steps.push({ action: "startRaffle", raffleId: s.raffleId });
  } else if (r.state === 1) {
    // DRAWING
    if (s.blockNumber > r.seedBlock && s.blockNumber <= r.seedBlock + FINALIZE_WINDOW_BLOCKS) {
      steps.push({ action: "finalize", raffleId: s.raffleId });
    } else if (s.blockNumber > r.seedBlock + FINALIZE_WINDOW_BLOCKS) {
      // finalize window missed — re-draw for a fresh seed, then finalize
      steps.push({ action: "draw", raffleId: s.raffleId });
      steps.push({ action: "finalize", raffleId: s.raffleId });
    } else {
      // seed block not mined yet — wait for it, then finalize
      steps.push({ action: "finalize", raffleId: s.raffleId });
    }
    steps.push({ action: "startRaffle", raffleId: s.raffleId });
  } else {
    // FINALIZED — just start the next round
    steps.push({ action: "startRaffle", raffleId: s.raffleId });
  }
  return steps;
}

let plan = planFor(state);
if (plan.length === 0) {
  const r = state.raffle;
  log(
    `Draw not due: raffle #${state.raffleId} is OPEN, drawTime ${new Date(Number(r.drawTime) * 1000).toISOString()} ` +
    `is ${Number(r.drawTime - state.now)}s in the future. Nothing to do.`,
  );
  process.exit(0);
}
log(`Plan: ${plan.map((p) => p.action).join(" -> ")} (raffle #${state.raffleId})`);

if (DRY_RUN) {
  log("DRY RUN: would execute the plan above. No window opened, no tx sent.");
  process.exit(0);
}

// --- EVM window: reuse a usable live one, else open a long one ------------
async function ensureWindow() {
  const w = await getEvmWindow(operator);
  const reusable =
    w.found && w.live &&
    BigInt(w.remainingValue ?? 0) >= qorToUqor(REUSE.minValueQor) &&
    Number(w.remainingTxs ?? 0) >= REUSE.minTxs &&
    Number(w.remainingBlocks ?? 0) >= REUSE.minBlocks;
  if (reusable) {
    log(
      `Reusing live EVM window (opened at height ${w.openedHeight}, ${w.remainingBlocks} blocks / ${w.remainingTxs} txs / ${uqorToQor(w.remainingValue)} QOR left) — no native tx in this run.`,
    );
    return "reused";
  }
  log(
    `Opening EVM window (${WINDOW.blocks} blocks / ${WINDOW.maxTxs} txs / ${WINDOW.maxValueQor} QOR max)...`,
  );
  const eth = makeEthClient(unified, { signMode: "hybrid" });
  const windowMsg = openEvmWindowMsg({
    sender: operator,
    blocks: WINDOW.blocks,
    maxTxs: WINDOW.maxTxs,
    maxValue: qorToUqor(WINDOW.maxValueQor),
  });
  let open;
  try {
    open = await eth.broadcast([windowMsg], "BANZAI VEGAS keeper open EVM window");
  } catch (err) {
    fail(`Window-open failed (no tx sent): ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await eth.disconnect();
  }
  if (open.code !== 0) fail(`Window-open tx returned code ${open.code}.`);
  log(`  window-open tx: ${open.transactionHash}`);
  log(`  explorer: ${explorerTxUrl(open.transactionHash)}`);
  const after = await getEvmWindow(operator);
  if (!after.found || !after.live) {
    fail("Window-open tx landed but the window is not live — no EVM tx sent.");
  }
  log(`  window live: ${uqorToQor(after.remainingValue)} QOR remaining, ${after.remainingBlocks} blocks left.`);
  return "opened";
}

// --- EVM tx helper: probe estimation (aging wait), then send once ---------
async function sendEvmTx(functionName, args) {
  const call = { address: RAFFLE, abi: raffleAbi, functionName, args };
  // Probe: retry estimation until the window has aged in (deploy lesson).
  // A failed probe sends nothing; only a passing probe proceeds to send.
  const deadline = Date.now() + EST_RETRY_MS;
  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      const est = await publicClient.estimateContractGas({ ...call, account });
      log(`  ${functionName} gas estimate landed on attempt ${attempt}: ${est}`);
      break;
    } catch (err) {
      if (Date.now() > deadline) {
        throw new Error(
          `${functionName} estimation still reverting after ${attempt} attempts over 15 min — window never aged in: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (attempt === 1 || attempt % 6 === 0) {
        log(`  ${functionName} estimate reverted (attempt ${attempt}) — window still aging in, retrying in 10s...`);
      }
      await sleep(EST_RETRY_DELAY_MS);
    }
  }
  let maxFeePerGas;
  let maxPriorityFeePerGas;
  try {
    const fees = await publicClient.estimateFeesPerGas();
    maxFeePerGas = fees.maxFeePerGas;
    maxPriorityFeePerGas = fees.maxPriorityFeePerGas;
  } catch {
    maxFeePerGas = await publicClient.getGasPrice();
    maxPriorityFeePerGas = undefined;
  }
  const feeTerms = {
    maxFeePerGas,
    ...(maxPriorityFeePerGas !== undefined ? { maxPriorityFeePerGas } : {}),
  };
  const hash = await wallet.writeContract({ ...call, ...feeTerms });
  log(`  ${functionName} tx: ${hash}`);
  log(`  explorer: ${explorerTxUrl(hash)}`);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    timeout: RECEIPT_TIMEOUT_MS,
  });
  if (receipt.status !== "success") {
    fail(`${functionName} mined but FAILED (status ${receipt.status}).`);
  }
  log(`  ${functionName} confirmed in block ${receipt.blockNumber}.`);
  return receipt;
}

async function waitForSeedBlock(seedBlock) {
  for (;;) {
    const n = await publicClient.getBlockNumber();
    if (n > seedBlock) return n;
    await sleep(SEED_POLL_MS);
  }
}

// --- Execute the plan, re-reading state before every step -----------------
await ensureWindow();

for (const step of plan) {
  // Re-read state: a previous step (or an earlier run) may have moved on.
  state = await readState();
  const r = state.raffle;
  log(`Step ${step.action}: ${describeState(state)}`);

  if (step.action === "draw") {
    if (r.state === 2) {
      log("  already FINALIZED — draw skipped (a re-run caught up).");
      continue;
    }
    if (r.state === 1) {
      // Re-draw rescue: only valid once the finalize window has expired.
      if (state.blockNumber <= r.seedBlock + FINALIZE_WINDOW_BLOCKS) {
        log("  still inside the finalize window — re-draw not needed, going to finalize.");
        continue;
      }
      log(`  finalize window missed (seedBlock ${r.seedBlock}, block ${state.blockNumber}) — re-drawing for a fresh seed.`);
    }
    if (state.now < r.drawTime) {
      fail(`drawTime ${new Date(Number(r.drawTime) * 1000).toISOString()} has not passed — refusing to draw early.`);
    }
    await sendEvmTx("draw", []);
    state = await readState();
    log(`  draw done — seedBlock ${state.raffle.seedBlock}, state ${STATE_NAMES[state.raffle.state]}.`);
  } else if (step.action === "finalize") {
    if (r.state === 2) {
      log("  already FINALIZED — finalize skipped (a re-run caught up).");
      continue;
    }
    if (r.state !== 1) {
      fail(`cannot finalize from state ${STATE_NAMES[r.state]} — expected DRAWING.`);
    }
    if (state.blockNumber <= r.seedBlock) {
      log(`  seed block ${r.seedBlock} not mined yet (block ${state.blockNumber}) — waiting...`);
      await waitForSeedBlock(r.seedBlock);
      state = await readState();
    }
    if (state.blockNumber > r.seedBlock + FINALIZE_WINDOW_BLOCKS) {
      log(`  finalize window missed (seedBlock ${r.seedBlock}, block ${state.blockNumber}) — re-drawing first.`);
      await sendEvmTx("draw", []);
      state = await readState();
      log(`  re-draw done — new seedBlock ${state.raffle.seedBlock}.`);
      if (state.blockNumber <= state.raffle.seedBlock) {
        await waitForSeedBlock(state.raffle.seedBlock);
        state = await readState();
      }
    }
    const tickets = state.raffle.totalTickets;
    if (tickets === 0n) {
      log("  0 tickets sold — finalize() is safe (no winners, pot rolls over).");
    }
    await sendEvmTx("finalize", []);
    state = await readState();
    const winners = await publicClient.readContract({
      address: RAFFLE,
      abi: raffleAbi,
      functionName: "getWinners",
      args: [state.raffleId],
    });
    log(`  finalized — ${winners.length} winner(s), state ${STATE_NAMES[state.raffle.state]}.`);
    for (const w of winners) {
      const ticketId = w.ticketId ?? w[1];
      const player = w.player ?? w[0];
      const prize = w.prize ?? w[2];
      log(`    winner: ticket #${ticketId} player ${player} prize ${uqorToQor(BigInt(prize) / 1_000_000_000_000n)} QOR`);
    }
  } else if (step.action === "startRaffle") {
    if (r.state !== 2) {
      fail(`cannot start the next round from state ${STATE_NAMES[r.state]} — expected FINALIZED.`);
    }
    const next = nextDrawTime(r.drawTime, state.now);
    // Idempotency guard: if a newer round is already OPEN, do not start another.
    if (state.raffleId > step.raffleId) {
      log(`  raffle #${state.raffleId} is already OPEN — start skipped (a re-run caught up).`);
      continue;
    }
    log(`  starting raffle #${state.raffleId + 1n} with drawTime ${new Date(Number(next) * 1000).toISOString()} (${next}).`);
    await sendEvmTx("startRaffle", [next]);
    state = await readState();
    log(`  raffle #${state.raffleId} OPEN, drawTime ${new Date(Number(state.raffle.drawTime) * 1000).toISOString()}.`);
  }
}

state = await readState();
log(`Done. Final state: ${describeState(state)}`);
log(`Raffle: ${explorerAddressUrl(RAFFLE)}`);
