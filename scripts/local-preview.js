// Local-only preview helper: deploy the QOR raffle on a local Hardhat
// node, start a round (next Sun/Tue/Thu 20:00 UTC), buy 5 tickets from a
// second account, and print the state as JSON for the screenshot harness.
// No real chain, no real funds — the local node is throwaway.
//   1. npx hardhat node --port 8545   (in another shell)
//   2. npx hardhat run scripts/local-preview.js --network localhost
const { ethers } = require("hardhat");

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

async function main() {
  const [owner, buyer] = await ethers.getSigners();
  const Raffle = await ethers.getContractFactory("BanzaiRaffle");
  const raffle = await Raffle.deploy();
  await raffle.waitForDeployment();
  const addr = await raffle.getAddress();
  const draw = nextDrawTime(new Date());
  const drawUnix = Math.floor(draw.getTime() / 1000);
  await raffle.connect(owner).startRaffle(drawUnix);
  await raffle.connect(buyer).buyTickets(5, { value: ethers.parseEther("25") });
  const tickets = await raffle.getPlayerTickets(1, buyer.address);
  const r = await raffle.getRaffle(1);
  console.log(JSON.stringify({
    raffle: addr,
    drawTime: draw.toISOString(),
    drawTimeUnix: drawUnix,
    buyer: buyer.address,
    tickets: tickets.map(Number),
    potQor: ethers.formatEther(r.pot),
    totalTickets: Number(r.totalTickets),
    playerCount: Number(r.playerCount),
  }));
}

main().catch((e) => { console.error(e); process.exit(1); });
