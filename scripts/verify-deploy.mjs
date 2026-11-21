// Verify the deployed Banzai Vegas contracts on QoreChain EVM (read-only).
// Reads token name/symbol/supply + raffle round-1 state from deployment.json.
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

const tokenAbi = JSON.parse(readFileSync(new URL("../artifacts/contracts/BanzaiToken.sol/BanzaiToken.json", import.meta.url), "utf8")).abi;
const raffleAbi = JSON.parse(readFileSync(new URL("../artifacts/contracts/BanzaiRaffle.sol/BanzaiRaffle.json", import.meta.url), "utf8")).abi;

const [name, symbol, supply] = await Promise.all([
  client.readContract({ address: dep.token, abi: tokenAbi, functionName: "name" }),
  client.readContract({ address: dep.token, abi: tokenAbi, functionName: "symbol" }),
  client.readContract({ address: dep.token, abi: tokenAbi, functionName: "totalSupply" }),
]);
console.log(`TOKEN ${dep.token}: name=${name} symbol=${symbol} totalSupply=${supply}`);

const [raffleId, r1, rToken, rOwner] = await Promise.all([
  client.readContract({ address: dep.raffle, abi: raffleAbi, functionName: "currentRaffleId" }),
  client.readContract({ address: dep.raffle, abi: raffleAbi, functionName: "raffles", args: [1n] }),
  client.readContract({ address: dep.raffle, abi: raffleAbi, functionName: "token" }),
  client.readContract({ address: dep.raffle, abi: raffleAbi, functionName: "owner" }),
]);
console.log(`RAFFLE ${dep.raffle}: currentRaffleId=${raffleId} token=${rToken} owner=${rOwner}`);
console.log(`ROUND 1: drawTime=${r1[0]} (${new Date(Number(r1[0]) * 1000).toISOString()}) pot=${r1[1]} state=${r1[4]} (0=OPEN)`);
console.log(`EXPECTED drawTime: ${dep.drawTimeUnix} (${dep.drawTime})`);
