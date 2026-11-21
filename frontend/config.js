// BANZAI VEGAS frontend config — QoreChain testnet (qorechain-diana, EVM 9800).
// QOR-native raffle: tickets AND payouts are paid in native QOR. There is
// no play token anymore (BanzaiToken retired 21 Nov 2026) — players get QOR
// from the QoreChain faucet (100 QOR/24h) and pay 5 QOR per ticket.
// After deploying (see DEPLOY.md), the deploy script writes
// deployed-addresses.json — the app prefers it when its chainId matches
// the network (9800).
const CONFIG = {
  chainId: 9800,
  chainName: "QoreChain Testnet",
  rpcUrl: "https://evm-testnet.qore.host",
  blockExplorer: "https://explore.qore.network",
  qorFaucetUrl: "https://dashboard.qorechain.io/faucet",
  raffleAddress: "0x0000000000000000000000000000000000000000", // BanzaiRaffle — REPLACE AFTER DEPLOYMENT
  ticketPriceQOR: 5,
  maxTicketsPerPlayer: 20,
};

const RAFFLE_ABI = [
  "function currentRaffleId() view returns (uint256)",
  "function getRaffle(uint256) view returns (tuple(uint256 drawTime, uint256 pot, uint256 totalTickets, uint256 playerCount, uint256 seedBlock, uint8 state))",
  "function buyTickets(uint256 count) payable",
  "function draw()",
  "function finalize()",
  "function claim(uint256 raffleId)",
  "function claimable(uint256 raffleId, address player) view returns (uint256)",
  "function getPlayerTickets(uint256 raffleId, address player) view returns (uint256[])",
  "function getWinners(uint256 raffleId) view returns (tuple(address player, uint256 ticketId, uint256 prize, bool claimed)[])",
  "function TICKET_PRICE() view returns (uint256)",
  "function MAX_TICKETS_PER_PLAYER() view returns (uint256)",
];
