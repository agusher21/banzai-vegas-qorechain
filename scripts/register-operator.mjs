// BANZAI VEGAS (QoreChain) — register the operator's ML-DSA-87 key on chain.
// Run once, AFTER funding the operator from the faucet:
//   node scripts/register-operator.mjs
// Reads the operator identity from .env.local (never prints the mnemonic),
// and registers via the eth-native signer (scripts/qore-eth.mjs) — the
// operator is a UNIFIED account, so its registration tx is signed classical
// with the eth_secp256k1 scheme (bootstrap-exempt MsgRegisterPQCKeyV2).
// Idempotent: if the key is already registered it reports that and sends
// nothing. Then it verifies the registration with a fresh REST read.
// Fails cleanly with "operator unfunded — claim the faucet first" when the
// balance is 0, because registration costs gas the operator does not have.
import { createHash } from "node:crypto";
import {
  FAUCET_URL,
  deriveOperator,
  explorerTxUrl,
  getBalanceUqor,
  getPqcStatus,
  loadEnvFile,
  uqorToQor,
} from "./qore-common.mjs";
import { registerPqcEth } from "./qore-eth.mjs";

const env = loadEnvFile();
const { unified, pqcKeypair } = await deriveOperator(env);

const fingerprint = createHash("sha256")
  .update(Buffer.from(pqcKeypair.publicKey))
  .digest("hex")
  .slice(0, 32);
console.log(`Operator: ${unified.cosmos}`);
console.log(`  EVM: ${unified.evm}`);
console.log(
  `  PQC pubkey: ML-DSA-87, ${pqcKeypair.publicKey.length} bytes, fingerprint ${fingerprint}…`,
);

const balance = await getBalanceUqor(unified.cosmos);
console.log(`  Balance: ${uqorToQor(balance)} QOR`);
if (balance === 0n) {
  console.error(
    "\nOperator unfunded — claim the faucet first:\n" +
      `  ${FAUCET_URL} → 100 QOR to ${unified.cosmos}\n` +
      "Then re-run: node scripts/register-operator.mjs",
  );
  process.exit(1);
}

const statusBefore = await getPqcStatus(unified.cosmos);
console.log(
  `  PQC registered before: ${statusBefore.registered ? `yes (algorithm ${statusBefore.algorithmId ?? "?"})` : "no"}`,
);
if (statusBefore.registered) {
  console.log("  Already registered — no transaction sent.");
  console.log("  Next: node scripts/deploy-qorechain.mjs");
  process.exit(0);
}

// Classical client: the registration transaction itself stays classical;
// hybrid signing starts only after the key exists.
const result = await registerPqcEth(unified, pqcKeypair);
if (result.code !== 0) {
  console.error(`  Registration tx FAILED (code ${result.code}): ${result.rawLog ?? ""}`);
  process.exit(1);
}
console.log(`  Registration tx: ${result.transactionHash}`);
console.log(`  Explorer: ${explorerTxUrl(result.transactionHash)}`);

const statusAfter = await getPqcStatus(unified.cosmos);
if (!statusAfter.registered) {
  console.error("  VERIFY FAILED: PQC key still not registered after the run.");
  process.exit(1);
}
console.log(
  `  Verified: PQC key registered (algorithm ${statusAfter.algorithmId ?? "?"}).`,
);
console.log("  Next: node scripts/deploy-qorechain.mjs");
