// BANZAI VEGAS frontend config — QoreChain testnet (qorechain-diana, EVM 9800).
// After deploying (see DEPLOY.md), paste the real QoreChain addresses here
// OR let scripts/deploy-qorechain.mjs write deployed-addresses.json — the app
// prefers deployed-addresses.json when its chainId matches the network (9800).
const CONFIG = {
  chainId: 9800,
  chainName: "QoreChain Testnet",
  rpcUrl: "https://evm-testnet.qore.host",
  blockExplorer: "https://explore.qore.network",
  qorFaucetUrl: "https://dashboard.qorechain.io/faucet",
  tokenAddress: "0x0000000000000000000000000000000000000000", // BNZ — REPLACE AFTER DEPLOYMENT
  raffleAddress: "0x0000000000000000000000000000000000000000", // BanzaiRaffle — REPLACE AFTER DEPLOYMENT
  ticketPriceBNZ: 5,
  maxTicketsPerPlayer: 20,
};

const TOKEN_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function faucet()",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

const RAFFLE_ABI = [
  "function currentRaffleId() view returns (uint256)",
  "function getRaffle(uint256) view returns (tuple(uint256 drawTime, uint256 pot, uint256 totalTickets, uint256 playerCount, uint256 seedBlock, uint8 state))",
  "function buyTickets(uint256 count)",
  "function draw()",
  "function finalize()",
  "function claim(uint256 raffleId)",
  "function claimable(uint256 raffleId, address player) view returns (uint256)",
  "function getPlayerTickets(uint256 raffleId, address player) view returns (uint256[])",
  "function getWinners(uint256 raffleId) view returns (tuple(address player, uint256 ticketId, uint256 prize, bool claimed)[])",
  "function TICKET_PRICE() view returns (uint256)",
  "function MAX_TICKETS_PER_PLAYER() view returns (uint256)",
];
