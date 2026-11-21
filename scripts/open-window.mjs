// BANZAI VEGAS (QoreChain) — open an EVM window ONLY (phase A of the deploy).
//   node scripts/open-window.mjs
// The deploy is TWO PHASES because a native tx from the operator in the
// SAME run breaks EVM contract-creation estimation for the window
// (verified 21 Nov 2026: 4 deploy runs failed this way; a standalone
// estimate against the same aged window works fine). So:
//   Phase A (this script): open the window (600 blocks / 10 txs / 2 QOR).
//   Wait ~8 min for it to age in, then:
//   Phase B: node scripts/deploy-qorechain.mjs --evm-only
// (which sends NO native tx and deploys against the live window).
// The operator key comes from .env.local only and is never printed.
import { openEvmWindowMsg } from "@qorechain/sdk";
import {
  FAUCET_URL,
  deriveOperator,
  explorerTxUrl,
  getBalanceUqor,
  getEvmWindow,
  getPqcStatus,
  loadEnvFile,
  qorToUqor,
  uqorToQor,
} from "./qore-common.mjs";
import { makeEthClient } from "./qore-eth.mjs";

const WINDOW = { blocks: 600, maxTxs: 10, maxValueQor: "2" };

function fail(message) {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}

const env = loadEnvFile();
const { unified } = await deriveOperator(env);
const operator = unified.cosmos;
console.log(`BANZAI VEGAS open-window — operator ${operator} (EVM ${unified.evm})`);

const balance = await getBalanceUqor(operator);
console.log(`Balance: ${uqorToQor(balance)} QOR`);
if (balance === 0n) {
  fail(
    `operator unfunded — claim the faucet first (100 QOR to ${operator} at ${FAUCET_URL}), then run node scripts/register-operator.mjs`,
  );
}
const pqc = await getPqcStatus(operator);
if (!pqc.registered) {
  fail(
    "operator PQC key not registered — run node scripts/register-operator.mjs first (it registers the ML-DSA-87 key on chain).",
  );
}
console.log(`PQC key registered (algorithm ${pqc.algorithmId ?? "?"}).`);

const existing = await getEvmWindow(operator);
if (
  existing.found && existing.live &&
  BigInt(existing.remainingValue ?? 0) >= qorToUqor(WINDOW.maxValueQor) &&
  Number(existing.remainingTxs ?? 0) >= 3 &&
  Number(existing.remainingBlocks ?? 0) >= 50
) {
  console.log(
    `\nA live window already covers this deploy (opened at height ${existing.openedHeight}, ${existing.remainingBlocks} blocks / ${existing.remainingTxs} txs / ${uqorToQor(existing.remainingValue)} QOR left). No new window opened.`,
  );
  console.log("Next: node scripts/deploy-qorechain.mjs --evm-only");
  process.exit(0);
}

const eth = makeEthClient(unified, { signMode: "hybrid" });
console.log(`\nOpening EVM window (${WINDOW.blocks} blocks / ${WINDOW.maxTxs} txs / ${WINDOW.maxValueQor} QOR max)...`);
const windowMsg = openEvmWindowMsg({
  sender: operator,
  blocks: WINDOW.blocks,
  maxTxs: WINDOW.maxTxs,
  maxValue: qorToUqor(WINDOW.maxValueQor),
});
let open;
try {
  open = await eth.broadcast([windowMsg], "BANZAI VEGAS open EVM window");
} catch (err) {
  fail(`Window-open failed (no tx sent): ${err instanceof Error ? err.message : String(err)}`);
}
if (open.code !== 0) fail(`Window-open tx returned code ${open.code}.`);
console.log(`  window-open tx: ${open.transactionHash}`);
console.log(`  explorer: ${explorerTxUrl(open.transactionHash)}`);
await eth.disconnect();

const window = await getEvmWindow(operator);
if (!window.found || !window.live) {
  fail("Window-open tx landed but the window is not live.");
}
console.log(`  window live: ${uqorToQor(window.remainingValue)} QOR remaining, ${window.remainingBlocks} blocks left.`);
console.log("\nNext: wait ~8 min for the window to age in, then run:");
console.log("  node scripts/deploy-qorechain.mjs --evm-only");
