const { expect } = require("chai");
const { ethers } = require("hardhat");

// All amounts are native QOR (the QoreChain testnet token). 1 QOR = 1 ether
// of value on the EVM side. No play token is involved anymore — the BNZ
// token contract was retired 21 Nov 2026.
const QOR = (n) => ethers.parseEther(n.toString());
const DAY = 24 * 60 * 60;

async function deploy() {
  const [owner, ...players] = await ethers.getSigners();
  const Raffle = await ethers.getContractFactory("BanzaiRaffle");
  const raffle = await Raffle.deploy();
  return { owner, players, raffle };
}

async function latestTimestamp() {
  return (await ethers.provider.getBlock("latest")).timestamp;
}

async function startRound(raffle, owner, inSeconds = DAY) {
  const drawTime = (await latestTimestamp()) + inSeconds;
  await raffle.connect(owner).startRaffle(drawTime);
  return drawTime;
}

async function buy(raffle, player, count) {
  const cost = QOR(5) * BigInt(count);
  await raffle.connect(player).buyTickets(count, { value: cost });
}

async function sendQor(from, to, amount) {
  await from.sendTransaction({ to, value: amount });
}

describe("BanzaiRaffle — buying (native QOR)", function () {
  it("buys tickets, assigns sequential ids, grows the pot, counts players", async function () {
    const { owner, players, raffle } = await deploy();
    await startRound(raffle, owner);
    await buy(raffle, players[0], 3);
    await buy(raffle, players[1], 2);
    const r = await raffle.getRaffle(1);
    expect(r.totalTickets).to.equal(5);
    expect(r.pot).to.equal(QOR(25));
    expect(r.playerCount).to.equal(2);
    expect(await raffle.getPlayerTickets(1, players[0].address)).to.deep.equal([1n, 2n, 3n]);
    expect(await raffle.getPlayerTickets(1, players[1].address)).to.deep.equal([4n, 5n]);
    expect(await raffle.ticketOwner(1, 4)).to.equal(players[1].address);
    // The pot is real native balance sitting in the contract.
    expect(await ethers.provider.getBalance(await raffle.getAddress())).to.equal(QOR(25));
  });

  it("enforces max 20 tickets per player per round", async function () {
    const { owner, players, raffle } = await deploy();
    await startRound(raffle, owner);
    await buy(raffle, players[0], 20);
    await expect(buy(raffle, players[0], 1)).to.be.revertedWith(
      "BanzaiRaffle: max 20 tickets per player"
    );
  });

  it("rejects buying 0 tickets", async function () {
    const { owner, players, raffle } = await deploy();
    await startRound(raffle, owner);
    await expect(buy(raffle, players[0], 0)).to.be.revertedWith(
      "BanzaiRaffle: buy at least 1 ticket"
    );
  });

  it("rejects buying with the wrong QOR amount (underpay / overpay / none)", async function () {
    const { owner, players, raffle } = await deploy();
    await startRound(raffle, owner);
    const addr = await raffle.getAddress();
    await expect(
      raffle.connect(players[0]).buyTickets(2, { value: QOR(9) })
    ).to.be.revertedWith("BanzaiRaffle: send exactly count * 5 QOR");
    await expect(
      raffle.connect(players[0]).buyTickets(2, { value: QOR(11) })
    ).to.be.revertedWith("BanzaiRaffle: send exactly count * 5 QOR");
    await expect(
      raffle.connect(players[0]).buyTickets(1)
    ).to.be.revertedWith("BanzaiRaffle: send exactly count * 5 QOR");
    expect((await raffle.getRaffle(1)).totalTickets).to.equal(0);
    expect(await ethers.provider.getBalance(addr)).to.equal(0);
  });

  it("rejects buying after sales close", async function () {
    const { owner, players, raffle } = await deploy();
    await startRound(raffle, owner, 60);
    await ethers.provider.send("evm_increaseTime", [61]);
    await ethers.provider.send("evm_mine");
    await expect(buy(raffle, players[0], 1)).to.be.revertedWith(
      "BanzaiRaffle: sales closed"
    );
  });

  it("only the owner can start a round, and drawTime must be in the future", async function () {
    const { owner, players, raffle } = await deploy();
    await expect(
      raffle.connect(players[0]).startRaffle((await latestTimestamp()) + DAY)
    ).to.be.revertedWithCustomError(raffle, "NotOwner");
    await expect(
      raffle.connect(owner).startRaffle(await latestTimestamp())
    ).to.be.revertedWithCustomError(raffle, "InvalidDrawTime");
  });

  it("plain QOR transfers are accepted and roll into the next round's pot", async function () {
    const { owner, players, raffle } = await deploy();
    const addr = await raffle.getAddress();
    await sendQor(players[0], addr, QOR(7));
    await startRound(raffle, owner, 60);
    expect((await raffle.getRaffle(1)).pot).to.equal(QOR(7));
  });
});

describe("BanzaiRaffle — draw & finalize", function () {
  it("rejects draw before drawTime; draw records seedBlock = block.number + 1", async function () {
    const { owner, players, raffle } = await deploy();
    await startRound(raffle, owner);
    await expect(raffle.connect(players[0]).draw()).to.be.revertedWith(
      "BanzaiRaffle: sales still open"
    );
    await ethers.provider.send("evm_increaseTime", [DAY]);
    await ethers.provider.send("evm_mine");
    await raffle.connect(players[0]).draw();
    const r = await raffle.getRaffle(1);
    expect(r.state).to.equal(1); // DRAWING
    expect(r.seedBlock).to.equal((await ethers.provider.getBlockNumber()) + 1);
  });

  it("rejects finalize before the seed block is mined", async function () {
    const { owner, raffle } = await deploy();
    await startRound(raffle, owner, 60);
    await ethers.provider.send("evm_increaseTime", [61]);
    await ethers.provider.send("evm_mine");
    await raffle.draw();
    await expect(raffle.finalize()).to.be.revertedWith(
      "BanzaiRaffle: seed block not mined"
    );
  });

  it("finalize picks winners matching an off-chain replay of the shuffle", async function () {
    const { owner, players, raffle } = await deploy();
    await startRound(raffle, owner, 60);
    // 5 players x 20 tickets = 100 tickets = 500 QOR pot
    for (let i = 0; i < 5; i++) {
      await buy(raffle, players[i], 20);
    }
    await ethers.provider.send("evm_increaseTime", [61]);
    await ethers.provider.send("evm_mine");
    await raffle.draw();
    await ethers.provider.send("evm_mine"); // mine the seed block
    const seedBlock = Number((await raffle.getRaffle(1)).seedBlock);
    const seed = (await ethers.provider.getBlock(seedBlock)).hash;
    await raffle.finalize();

    // Off-chain replay: same Fisher-Yates partial shuffle, same seed.
    const t = 100;
    const ids = Array.from({ length: t }, (_, i) => i + 1);
    const amounts = [QOR(150), QOR(90), QOR(60), QOR(100), QOR(100)]; // 30/18/12%, 2x100, 0 remainder
    const expected = [];
    for (let i = 0; i < 5; i++) {
      const rand = BigInt(
        ethers.solidityPackedKeccak256(["bytes32", "uint256"], [seed, i])
      );
      const j = i + Number(rand % BigInt(t - i));
      [ids[i], ids[j]] = [ids[j], ids[i]];
      expected.push(ids[i]);
    }
    const winners = await raffle.getWinners(1);
    expect(winners.length).to.equal(5);
    for (let i = 0; i < 5; i++) {
      expect(winners[i].ticketId).to.equal(expected[i]);
      expect(winners[i].prize).to.equal(amounts[i]);
      const ownerOfTicket = await raffle.ticketOwner(1, winners[i].ticketId);
      expect(winners[i].player).to.equal(ownerOfTicket);
    }
    expect((await raffle.getRaffle(1)).state).to.equal(2); // FINALIZED
  });

  it("ASE-shape pot 7,275 QOR pays 2182.5 / 1309.5 / 873 / 29x100 / 10", async function () {
    const { owner, players, raffle } = await deploy();
    const addr = await raffle.getAddress();
    // Seed the pot via rollover = 5,375 QOR, sent as plain QOR transfers
    // (the old BNZ version used token transfers for this).
    await sendQor(owner, addr, QOR(2000));
    for (let i = 0; i < 3; i++) {
      await sendQor(players[i], addr, QOR(1000));
    }
    await sendQor(players[3], addr, QOR(375));
    await startRound(raffle, owner, 60);
    expect((await raffle.getRaffle(1)).pot).to.equal(QOR(5375)); // rollover
    // 380 tickets (19 players x 20) = 1,900 QOR -> pot 7,275
    for (let i = 0; i < 19; i++) {
      await buy(raffle, players[i], 20);
    }
    expect((await raffle.getRaffle(1)).pot).to.equal(QOR(7275));
    await ethers.provider.send("evm_increaseTime", [61]);
    await ethers.provider.send("evm_mine");
    await raffle.draw();
    await ethers.provider.send("evm_mine");
    await raffle.finalize();
    const winners = await raffle.getWinners(1);
    expect(winners.length).to.equal(33); // 3 top + 29 lots + 1 remainder
    const prizes = winners.map((w) => w.prize);
    expect(prizes[0]).to.equal(QOR(2182.5));
    expect(prizes[1]).to.equal(QOR(1309.5));
    expect(prizes[2]).to.equal(QOR(873));
    for (let i = 3; i < 32; i++) expect(prizes[i]).to.equal(QOR(100));
    expect(prizes[32]).to.equal(QOR(10));
    const total = prizes.reduce((a, b) => a + b, 0n);
    expect(total).to.equal(QOR(7275)); // whole pot allocated
  });

  it("few tickets: only the top prizes that have tickets are paid; rest rolls over", async function () {
    const { owner, players, raffle } = await deploy();
    await startRound(raffle, owner, 60);
    await buy(raffle, players[0], 2); // 10 QOR pot, 2 tickets
    await ethers.provider.send("evm_increaseTime", [61]);
    await ethers.provider.send("evm_mine");
    await raffle.draw();
    await ethers.provider.send("evm_mine");
    await raffle.finalize();
    const winners = await raffle.getWinners(1);
    expect(winners.length).to.equal(2);
    expect(winners[0].prize).to.equal(QOR(3)); // 30% of 10
    expect(winners[1].prize).to.equal(QOR(1.8)); // 18% of 10
    // Unallocated 5.2 QOR stays in the contract; next round starts with it.
    await raffle.connect(owner).startRaffle((await latestTimestamp()) + DAY);
    expect((await raffle.getRaffle(2)).pot).to.equal(QOR(5.2));
  });

  it("zero-ticket round finalizes with no winners and the pot rolls over", async function () {
    const { owner, raffle } = await deploy();
    const addr = await raffle.getAddress();
    await sendQor(owner, addr, QOR(50));
    await startRound(raffle, owner, 60);
    expect((await raffle.getRaffle(1)).pot).to.equal(QOR(50));
    await ethers.provider.send("evm_increaseTime", [61]);
    await ethers.provider.send("evm_mine");
    await raffle.draw();
    await ethers.provider.send("evm_mine");
    await raffle.finalize();
    expect((await raffle.getWinners(1)).length).to.equal(0);
    await raffle.connect(owner).startRaffle((await latestTimestamp()) + DAY);
    expect((await raffle.getRaffle(2)).pot).to.equal(QOR(50));
  });

  it("missed 256-block finalize window: finalize reverts, re-draw rescues the round", async function () {
    const { owner, players, raffle } = await deploy();
    await startRound(raffle, owner, 60);
    await buy(raffle, players[0], 5);
    await ethers.provider.send("evm_increaseTime", [61]);
    await ethers.provider.send("evm_mine");
    await raffle.draw();
    for (let i = 0; i < 257; i++) await ethers.provider.send("evm_mine");
    await expect(raffle.finalize()).to.be.revertedWith(
      "BanzaiRaffle: seed expired, call draw() again"
    );
    await raffle.draw(); // fresh seed block
    await ethers.provider.send("evm_mine");
    await raffle.finalize();
    // 5 tickets, 25 QOR pot -> 4 prize slots (7.5/4.5/3/10)
    expect((await raffle.getWinners(1)).length).to.equal(4);
  });
});

describe("BanzaiRaffle — claiming (native QOR)", function () {
  async function finalizedRound() {
    const { owner, players, raffle } = await deploy();
    await startRound(raffle, owner, 60);
    for (let i = 0; i < 3; i++) {
      await buy(raffle, players[i], 10); // 30 tickets = 150 QOR
    }
    await ethers.provider.send("evm_increaseTime", [61]);
    await ethers.provider.send("evm_mine");
    await raffle.draw();
    await ethers.provider.send("evm_mine");
    await raffle.finalize();
    return { owner, players, raffle };
  }

  it("winner claims and receives QOR; double claim reverts", async function () {
    const { players, raffle } = await finalizedRound();
    const winners = await raffle.getWinners(1);
    const w0 = winners[0];
    // claim() pays ALL of the player's winning slots, so sum them.
    const total = winners
      .filter((w) => w.player === w0.player)
      .reduce((a, w) => a + w.prize, 0n);
    const signer = await ethers.getSigner(w0.player);
    const tx = await raffle.connect(signer).claim(1);
    await expect(tx).to.emit(raffle, "Claimed").withArgs(1, w0.player, total);
    await expect(tx).to.changeEtherBalance(signer, total);
    await expect(
      raffle.connect(signer).claim(1)
    ).to.be.revertedWithCustomError(raffle, "NothingToClaim");
  });

  it("non-winner claim reverts", async function () {
    const { players, raffle } = await finalizedRound();
    const winnerAddrs = new Set((await raffle.getWinners(1)).map((w) => w.player));
    const loser = players.find((p) => !winnerAddrs.has(p.address));
    // With 30 tickets and 4 prize slots, some players may hold no winning
    // ticket; if every player won, use a fresh address instead.
    const loserAddr = loser ? loser.address : (await ethers.getSigners())[19].address;
    const loserSigner = await ethers.getSigner(loserAddr);
    await expect(raffle.connect(loserSigner).claim(1)).to.be.revertedWithCustomError(
      raffle,
      "NothingToClaim"
    );
  });

  it("prizes never expire: claiming works a year later", async function () {
    const { players, raffle } = await finalizedRound();
    const winners = await raffle.getWinners(1);
    const w0 = winners[0];
    const total = winners
      .filter((w) => w.player === w0.player)
      .reduce((a, w) => a + w.prize, 0n);
    await ethers.provider.send("evm_increaseTime", [365 * DAY]);
    await ethers.provider.send("evm_mine");
    const signer = await ethers.getSigner(w0.player);
    const tx = await raffle.connect(signer).claim(1);
    await expect(tx).to.changeEtherBalance(signer, total);
  });

  it("claimable() reports the exact unclaimed amount", async function () {
    const { raffle } = await finalizedRound();
    const winners = await raffle.getWinners(1);
    const w0 = winners[0];
    // A player may hold several winning tickets; claimable sums them all.
    const total = winners
      .filter((w) => w.player === w0.player)
      .reduce((a, w) => a + w.prize, 0n);
    expect(await raffle.claimable(1, w0.player)).to.equal(total);
  });
});

describe("BanzaiRaffle — native QOR accounting", function () {
  it("contract balance always equals pot + unclaimed prizes", async function () {
    const { owner, players, raffle } = await deploy();
    const addr = await raffle.getAddress();
    await startRound(raffle, owner, 60);
    for (let i = 0; i < 3; i++) await buy(raffle, players[i], 10); // 150 QOR
    expect(await ethers.provider.getBalance(addr)).to.equal(QOR(150));
    await ethers.provider.send("evm_increaseTime", [61]);
    await ethers.provider.send("evm_mine");
    await raffle.draw();
    await ethers.provider.send("evm_mine");
    await raffle.finalize();
    // Whole 150 QOR pot allocated, so balance == totalUnclaimed.
    expect(await raffle.totalUnclaimed()).to.equal(QOR(150));
    expect(await ethers.provider.getBalance(addr)).to.equal(QOR(150));
    // Claim one winner: balance and unclaimed drop by the same amount.
    const winners = await raffle.getWinners(1);
    const w0 = winners[0];
    const total = winners
      .filter((w) => w.player === w0.player)
      .reduce((a, w) => a + w.prize, 0n);
    await raffle.connect(await ethers.getSigner(w0.player)).claim(1);
    expect(await raffle.totalUnclaimed()).to.equal(QOR(150) - total);
    expect(await ethers.provider.getBalance(addr)).to.equal(QOR(150) - total);
  });

  it("owner cannot withdraw: there is no withdrawal function", async function () {
    const { raffle } = await deploy();
    // The ABI exposes no withdraw/rescue function at all — the owner can
    // only startRaffle, and unclaimed prizes roll over, never to the owner.
    const fnNames = raffle.interface.fragments
      .filter((f) => f.type === "function")
      .map((f) => f.name);
    const suspicious = fnNames.filter((s) => /withdraw|rescue|drain|sweep/i.test(s));
    expect(suspicious).to.deep.equal([]);
  });
});
