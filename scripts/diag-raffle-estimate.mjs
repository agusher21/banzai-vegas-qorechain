// DIAGNOSTIC (read-only, no tx sent): does the BanzaiRaffle creation
// estimate revert because the constructor arg (token address) is missing
// from the estimate data?
// Run 7 proved the token estimate lands (1,155,794 gas, attempt 1) but the
// raffle estimate reverts with EstimateGasExecutionError. The deploy script
// estimates the raffle with bare bytecode (no args), while the real deploy
// passes args: [tokenAddr]. This script tests both shapes against the live
// window, using the operator's own EVM address as a placeholder token arg
// (the gas cost is essentially independent of the address value).
import { readFileSync } from "node:fs";
import { createPublicClient, defineChain, encodeDeployData, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  EVM_CHAIN_ID,
  EVM_RPC_URL,
  deriveOperator,
  getEvmWindow,
  loadEnvFile,
  uqorToQor,
} from "./qore-common.mjs";

const qoreEvmChain = defineChain({
  id: EVM_CHAIN_ID,
  name: "QoreChain Testnet EVM",
  nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: { default: { http: [EVM_RPC_URL] } },
});

function loadArtifact(name) {
  const p = new URL(`../artifacts/contracts/${name}.sol/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(p, "utf8"));
}

const env = loadEnvFile();
const { unified } = await deriveOperator(env);
const account = privateKeyToAccount(unified.privateKey);
const publicClient = createPublicClient({ chain: qoreEvmChain, transport: http(EVM_RPC_URL) });

const window = await getEvmWindow(unified.cosmos);
console.log(`window: found=${window.found} live=${window.live} remainingBlocks=${window.remainingBlocks} remainingTxs=${window.remainingTxs} remainingValue=${window.remainingValue ? uqorToQor(window.remainingValue) + " QOR" : "?"}`);
if (!window.found || !window.live) {
  console.log("NO LIVE WINDOW — open a fresh one (node scripts/open-window.mjs) before testing estimates.");
  process.exit(2);
}

const raffle = loadArtifact("BanzaiRaffle");

// A) WITH the constructor arg (placeholder = operator EVM address).
const withArgs = encodeDeployData({ abi: raffle.abi, bytecode: raffle.bytecode, args: [unified.evm] });
try {
  const est = await publicClient.estimateGas({ account, data: withArgs });
  console.log(`WITH args (placeholder token=${unified.evm}): LANDED ${est}`);
} catch (err) {
  console.log(`WITH args: REVERTED — ${err?.shortMessage ?? err?.message ?? err}`);
}

// B) WITHOUT the constructor arg (the shape the deploy script uses today).
try {
  const est = await publicClient.estimateGas({ account, data: raffle.bytecode });
  console.log(`WITHOUT args: LANDED ${est}`);
} catch (err) {
  console.log(`WITHOUT args: REVERTED — ${err?.shortMessage ?? err?.message ?? err}`);
}
