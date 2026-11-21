// BANZAI VEGAS (QoreChain) — deploy the raffle on qorechain-diana (EVM 9800).
//   node scripts/deploy-qorechain.mjs [--force]
// Flow (Sentinel pattern, proven 16 Nov 2026):
//   1. Preflight: operator funded + PQC key registered (else fail cleanly).
//   2. A hybrid-signed native tx (0.001 QOR to self) — the explicit
//      hybrid-signature proof for the Fest form. The EVM-window open below
//      is a second hybrid-signed tx.
//   3. Open a scoped EVM window (600 blocks / 10 txs / 2 QOR max) with a
//      hybrid-signed MsgOpenEVMWindow, then verify it is live. Opening the
//      window advances the EVM nonce — the EVM txs are signed after this.
//   4. Deploy BanzaiToken + BanzaiRaffle via viem (compiled artifacts from
//      `npx hardhat compile`), then start raffle #1 (draw = next Sun/Tue/Thu
//      20:00 UTC). All three EVM txs run inside the window; their max fees
//      are checked against the window's remaining value BEFORE the first one.
//   5. Write frontend/deployed-addresses.json + deployment.json (receipt
//      with every tx hash + explorer link).
// Refuses to redeploy when deployed-addresses.json already holds real
// QoreChain addresses, unless --force is passed.
// The operator key comes from .env.local only and is never printed.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { openEvmWindowMsg } from "@qorechain/sdk";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  CHAIN_ID,
  EVM_CHAIN_ID,
  EVM_RPC_URL,
  FAUCET_URL,
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

const MEMO_TAG = "BANZAI VEGAS";
const MSG_SEND_TYPE_URL = "/cosmos.bank.v1beta1.MsgSend";
const WINDOW = { blocks: 600, maxTxs: 10, maxValueQor: "2" };
const FORCE = process.argv.includes("--force");

const qoreEvmChain = defineChain({
  id: EVM_CHAIN_ID,
  name: "QoreChain Testnet EVM",
  nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: { default: { http: [EVM_RPC_URL] } },
  blockExplorers: { default: { name: "QoreChain Explorer", url: "https://explore.qore.network" } },
});

function fail(message) {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}

function nextDrawTime(from = new Date()) {
  const drawDays = new Set([0, 2, 4]); // Sun, Tue, Thu
  const d = new Date(from);
  d.setUTCMinutes(0, 0, 0);
  for (let i = 0; i < 8; i++) {
    const cand = new Date(d);
    cand.setUTCDate(d.getUTCDate() + i);
    cand.setUTCHours(20, 0, 0, 0);
    if (drawDays.has(cand.getUTCDay()) && cand.getTime() > from.getTime()) {
      return cand;
    }
  }
  throw new Error("nextDrawTime: no draw day found (unreachable)");
}

function loadArtifact(contractName) {
  const p = new URL(`../artifacts/contracts/${contractName}.sol/${contractName}.json`, import.meta.url);
  if (!existsSync(p)) {
    fail(`Missing compiled artifact for ${contractName} — run \`npx hardhat compile\` first.`);
  }
  return JSON.parse(readFileSync(p, "utf8"));
}

const deployedPath = new URL("../frontend/deployed-addresses.json", import.meta.url);
if (!FORCE && existsSync(deployedPath)) {
  try {
    const prev = JSON.parse(readFileSync(deployedPath, "utf8"));
    if (prev.chainId === EVM_CHAIN_ID && prev.token && prev.raffle &&
        !prev.token.startsWith("0x00000000") && !prev.raffle.startsWith("0x00000000")) {
      fail(
        `Already deployed on QoreChain (token ${prev.token}, raffle ${prev.raffle}). ` +
        `Re-run with --force to redeploy (old addresses are then abandoned).`,
      );
    }
  } catch (e) {
    if (e.message.startsWith("Already deployed")) throw e;
    // Unreadable / placeholder file — proceed to deploy.
  }
}

const env = loadEnvFile();
const { unified } = await deriveOperator(env);
const operator = unified.cosmos;
console.log(`BANZAI VEGAS deploy — operator ${operator} (EVM ${unified.evm})`);

// --- Preflight: balance + PQC registration -------------------------------
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

// Hybrid eth-native client: every native tx from here is secp256k1 +
// ML-DSA-87. Each broadcast() simulates first and aborts on a failed sim.
const eth = makeEthClient(unified, { signMode: "hybrid" });

// --- 1. Hybrid-signed proof tx: 0.001 QOR to self ------------------------
console.log("\n[1/4] Hybrid-signed proof tx (0.001 QOR to self)...");
const proofMsg = {
  typeUrl: MSG_SEND_TYPE_URL,
  value: {
    fromAddress: operator,
    toAddress: operator,
    amount: [{ denom: "uqor", amount: qorToUqor("0.001") }],
  },
};
let proof;
try {
  proof = await eth.broadcast([proofMsg], `${MEMO_TAG} hybrid proof`);
} catch (err) {
  fail(`Hybrid proof tx failed (no tx sent): ${err instanceof Error ? err.message : String(err)}`);
}
if (proof.code !== 0) fail(`Hybrid proof tx returned code ${proof.code}.`);
console.log(`  proof tx: ${proof.transactionHash}`);
console.log(`  explorer: ${explorerTxUrl(proof.transactionHash)}`);

// --- 2. Open the EVM window (hybrid-signed) ------------------------------
console.log(`\n[2/4] Opening EVM window (${WINDOW.blocks} blocks / ${WINDOW.maxTxs} txs / ${WINDOW.maxValueQor} QOR max)...`);
const windowMsg = openEvmWindowMsg({
  sender: operator,
  blocks: WINDOW.blocks,
  maxTxs: WINDOW.maxTxs,
  maxValue: qorToUqor(WINDOW.maxValueQor),
});
let open;
try {
  open = await eth.broadcast([windowMsg], `${MEMO_TAG} open EVM window`);
} catch (err) {
  fail(`Window-open failed (no tx sent): ${err instanceof Error ? err.message : String(err)}`);
}
if (open.code !== 0) fail(`Window-open tx returned code ${open.code}.`);
console.log(`  window-open tx: ${open.transactionHash}`);
console.log(`  explorer: ${explorerTxUrl(open.transactionHash)}`);

const window = await getEvmWindow(operator);
if (!window.found || !window.live) {
  fail("Window-open tx landed but the window is not live — no EVM tx sent.");
}
console.log(`  window live: ${window.remainingValue ? uqorToQor(window.remainingValue) + " QOR remaining" : "live"}`);
await eth.disconnect();

// --- 3. Deploy the contracts via viem (inside the window) ---------------
console.log("\n[3/4] Deploying contracts via viem (inside the window)...");
const account = privateKeyToAccount(unified.privateKey);
const wallet = createWalletClient({
  account,
  chain: qoreEvmChain,
  transport: http(EVM_RPC_URL),
});
const publicClient = createPublicClient({
  chain: qoreEvmChain,
  transport: http(EVM_RPC_URL),
});

// Fee terms (read live) + window budget check BEFORE the first deploy.
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
const tokenArtifact = loadArtifact("BanzaiToken");
const raffleArtifact = loadArtifact("BanzaiRaffle");

// Upper-bound the three EVM txs' max fees (deploys + startRaffle) against
// the window's remaining value, rounding up (1 uqor = 10^12 wei).
const tokenGasEst = await publicClient.estimateGas({
  account,
  data: tokenArtifact.bytecode,
});
const raffleGasEst = await publicClient.estimateGas({
  account,
  data: raffleArtifact.bytecode,
});
const startGasEst = 200_000n; // startRaffle is a simple SSTORE call; capped estimate
const totalGasEst = tokenGasEst + raffleGasEst + startGasEst;
const maxFeesWei = totalGasEst * maxFeePerGas;
const maxFeesUqor = (maxFeesWei + 999_999_999_999n) / 1_000_000_000_000n;
console.log(`  gas estimates: token ${tokenGasEst}, raffle ${raffleGasEst}, startRaffle ~${startGasEst}`);
console.log(`  max fees upper bound: ${uqorToQor(maxFeesUqor)} QOR (window remaining ${uqorToQor(window.remainingValue)} QOR)`);
if (maxFeesUqor > BigInt(window.remainingValue)) {
  fail(
    `Window remaining value (${uqorToQor(window.remainingValue)} QOR) does not cover the deploys' max fees (${uqorToQor(maxFeesUqor)} QOR) — no EVM tx sent. Open a bigger window or fund the operator more.`,
  );
}

const feeTerms = {
  maxFeePerGas,
  ...(maxPriorityFeePerGas !== undefined ? { maxPriorityFeePerGas } : {}),
};

const tokenHash = await wallet.deployContract({
  abi: tokenArtifact.abi,
  bytecode: tokenArtifact.bytecode,
  ...feeTerms,
});
const tokenReceipt = await publicClient.waitForTransactionReceipt({ hash: tokenHash, timeout: 120_000 });
if (tokenReceipt.status !== "success") fail(`BanzaiToken deploy mined but FAILED (status ${tokenReceipt.status}).`);
const tokenAddr = tokenReceipt.contractAddress;
console.log(`  BanzaiToken (BNZ) deployed at: ${tokenAddr}`);
console.log(`  explorer: ${explorerAddressUrl(tokenAddr)}`);

const raffleHash = await wallet.deployContract({
  abi: raffleArtifact.abi,
  bytecode: raffleArtifact.bytecode,
  args: [tokenAddr],
  ...feeTerms,
});
const raffleReceipt = await publicClient.waitForTransactionReceipt({ hash: raffleHash, timeout: 120_000 });
if (raffleReceipt.status !== "success") fail(`BanzaiRaffle deploy mined but FAILED (status ${raffleReceipt.status}).`);
const raffleAddr = raffleReceipt.contractAddress;
console.log(`  BanzaiRaffle deployed at: ${raffleAddr}`);
console.log(`  explorer: ${explorerAddressUrl(raffleAddr)}`);

// --- 4. Start raffle #1 ----------------------------------------------------
console.log("\n[4/4] Starting raffle #1...");
const draw = nextDrawTime(new Date());
const drawUnix = Math.floor(draw.getTime() / 1000);
console.log(`  draw time: ${draw.toISOString()} (${drawUnix})`);
const startHash = await wallet.writeContract({
  address: raffleAddr,
  abi: raffleArtifact.abi,
  functionName: "startRaffle",
  args: [BigInt(drawUnix)],
  ...feeTerms,
});
const startReceipt = await publicClient.waitForTransactionReceipt({ hash: startHash, timeout: 120_000 });
if (startReceipt.status !== "success") fail(`startRaffle mined but FAILED (status ${startReceipt.status}).`);
console.log(`  raffle #1 started (tx ${startHash}). Sales close at draw time.`);

const out = {
  network: "qorechain",
  chainId: EVM_CHAIN_ID,
  token: tokenAddr,
  raffle: raffleAddr,
  raffleId: 1,
  drawTime: draw.toISOString(),
  drawTimeUnix: drawUnix,
  ticketPriceBNZ: "5",
  maxTicketsPerPlayer: 20,
  deployer: unified.evm,
  operatorQor1: operator,
  deployedAt: new Date().toISOString(),
  txs: {
    hybridProof: proof.transactionHash,
    windowOpen: open.transactionHash,
    tokenDeploy: tokenHash,
    raffleDeploy: raffleHash,
    startRaffle: startHash,
  },
};
writeFileSync(deployedPath, JSON.stringify(out, null, 2) + "\n");
console.log(`\nWrote ${deployedPath}`);
writeFileSync(
  new URL("../deployment.json", import.meta.url),
  JSON.stringify({ ...out, explorer: { token: explorerAddressUrl(tokenAddr), raffle: explorerAddressUrl(raffleAddr) } }, null, 2) + "\n",
);
console.log("Wrote deployment.json (receipt with every tx hash + explorer link).");
console.log("\nNext: point the frontend at these addresses (it reads deployed-addresses.json),");
console.log("then fill the Fest Create-project form with the addresses + hybrid tx above.");
