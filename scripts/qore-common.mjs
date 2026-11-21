// BANZAI VEGAS (QoreChain) — shared helpers for the operator scripts.
// Adapted from the Quantum Sentinel pattern (proven 16 Nov 2026): a FRESH
// testnet-only account, PQC registration (ML-DSA-87), hybrid-signed native
// txs, and EVM work inside a hybrid-opened window.
// These scripts hold the operator's testnet-only key (from .env.local) and
// are NEVER run in a browser. The mnemonic is read here and never printed.
import { readFileSync, existsSync } from "node:fs";
import {
  deriveUnifiedAccount,
  derivePqcCanonical,
  fetchPqcStatus,
  fetchEvmWindow,
} from "@qorechain/sdk";

export const REST_URL = "https://api-testnet.qore.host";
export const RPC_URL = "https://rpc-testnet.qore.host";
export const EVM_RPC_URL = "https://evm-testnet.qore.host";
export const EXPLORER_HOME = "https://explore.qore.network";
export const CHAIN_ID = "qorechain-diana";
export const EVM_CHAIN_ID = 9800;
export const FAUCET_URL = "https://dashboard.qorechain.io/faucet";

const ROOT = new URL("..", import.meta.url);

/** Parse a KEY=VALUE .env file (quotes stripped, # comments ignored). */
export function loadEnvFile(path = new URL("../.env.local", import.meta.url)) {
  if (!existsSync(path)) {
    throw new Error(
      ".env.local not found — run `node scripts/setup-operator.mjs` first (once).",
    );
  }
  const env = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

export function explorerTxUrl(txHash) {
  const hex = txHash.startsWith("0x") ? txHash.slice(2) : txHash;
  return `${EXPLORER_HOME}/tx/${hex}`;
}

export function explorerAddressUrl(address) {
  return `${EXPLORER_HOME}/address/${address}`;
}

/**
 * Derive the operator identity from the mnemonic. Verifies the derived qor1
 * address matches OPERATOR_ADDRESS in .env.local, so a wrong/rotated .env
 * fails loudly instead of spending from an unexpected account.
 * Returns { unified, pqcKeypair } — the caller must never log these secrets.
 * unified carries .cosmos (qor1), .evm (0x) and .privateKey (hex, for viem).
 */
export async function deriveOperator(env) {
  const mnemonic = env.OPERATOR_MNEMONIC;
  if (!mnemonic) throw new Error(".env.local has no OPERATOR_MNEMONIC.");
  const unified = await deriveUnifiedAccount(mnemonic, 0);
  if (env.OPERATOR_ADDRESS && unified.cosmos !== env.OPERATOR_ADDRESS) {
    throw new Error(
      `Derived operator address ${unified.cosmos} does not match OPERATOR_ADDRESS ${env.OPERATOR_ADDRESS} in .env.local — refusing to run.`,
    );
  }
  if (env.OPERATOR_EVM_ADDRESS && unified.evm !== env.OPERATOR_EVM_ADDRESS) {
    throw new Error(
      `Derived operator EVM address ${unified.evm} does not match OPERATOR_EVM_ADDRESS in .env.local — refusing to run.`,
    );
  }
  const pqcKeypair = derivePqcCanonical(unified.cosmos, mnemonic);
  return { unified, pqcKeypair };
}

/** uqor balance of an address over REST (direct Node fetch, no CORS issue). */
export async function getBalanceUqor(address) {
  const res = await fetch(
    `${REST_URL}/cosmos/bank/v1beta1/balances/${address}?pagination.limit=100`,
  );
  if (!res.ok) {
    throw new Error(`Balance read failed: REST ${res.status} for ${address}`);
  }
  const data = await res.json();
  const row = (data.balances ?? []).find((b) => b.denom === "uqor");
  return row ? BigInt(row.amount) : 0n;
}

export function uqorToQor(uqor) {
  const v = BigInt(uqor);
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

export function qorToUqor(qor) {
  const [whole = "0", frac = ""] = String(qor).split(".");
  return (BigInt(whole) * 1_000_000n + BigInt((frac + "000000").slice(0, 6) || "0")).toString();
}

export async function getPqcStatus(address) {
  return fetchPqcStatus({ rest: REST_URL, address });
}

export async function getEvmWindow(address) {
  return fetchEvmWindow({ rest: REST_URL, address });
}
