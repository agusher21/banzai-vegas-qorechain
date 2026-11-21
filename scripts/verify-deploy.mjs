// Verify the deployed Banzai Vegas raffle on QoreChain EVM (read-only).
// Reads the raffle round-1 state + native QOR balance from deployment.json.
// (The BNZ token version of this script was retired with the token itself,
// 21 Nov 2026 — the raffle is QOR-native now.)
import { readFileSync } from "node:fs";
import { createPublicClient, defineChain, http } from "viem";
import { EVM_CHAIN_ID, EVM_RPC_URL } from "./qore-common.mjs";

const qoreEvmChain = defineChain({
  id: EVM_CHAIN_ID,
  name: "QoreChain Testnet EVM",
  nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: { default: { http: [EVM_RPC_URL] } },
});
const client = createPublicClient({ chain: qoreEvmChain, transport: http(EVM_RPC_URL) });
const dep = JSON.parse(readFileSync(new URL("../deployment.json", import.meta.url), "utf8"));

const raffleAbi = JSON.parse(readFileSync(new URL("../artifacts/contracts/BanzaiRaffle.sol/BanzaiRaffle.json", import.meta.url), "utf8")).abi;

const [raffleId, r1, rOwner] = await Promise.all([
  client.readContract({ address: dep.raffle, abi: raffleAbi, functionName: "currentRaffleId" }),
  client.readContract({ address: dep.raffle, abi: raffleAbi, functionName: "raffles", args: [1n] }),
  client.readContract({ address: dep.raffle, abi: raffleAbi, functionName: "owner" }),
]);
const balance = await client.getBalance({ address: dep.raffle });
console.log(`RAFFLE ${dep.raffle}: currentRaffleId=${raffleId} owner=${rOwner}`);
console.log(`ROUND 1: drawTime=${r1[0]} (${new Date(Number(r1[0]) * 1000).toISOString()}) pot=${r1[1]} state=${r1[4]} (0=OPEN)`);
console.log(`CONTRACT NATIVE BALANCE: ${balance} wei (pot + unclaimed prizes, in QOR)`);
console.log(`EXPECTED drawTime: ${dep.drawTimeUnix} (${dep.drawTime})`);
