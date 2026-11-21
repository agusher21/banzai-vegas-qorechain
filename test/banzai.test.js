const { expect } = require("chai");
const { ethers } = require("hardhat");

const BNZ = (n) => ethers.parseEther(n.toString());
const DAY = 24 * 60 * 60;

async function deploy() {
  const [owner, ...players] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("BanzaiToken");
  const token = await Token.deploy();
  const Raffle = await ethers.getContractFactory("BanzaiRaffle");
  const raffle = await Raffle.deploy(await token.getAddress());
  return { owner, players, token, raffle };
}

async function latestTimestamp() {
  return (await ethers.provider.getBlock("latest")).timestamp;
}

async function startRound(raffle, owner, inSeconds = DAY) {
  const drawTime = (await latestTimestamp()) + inSeconds;
  await raffle.connect(owner).startRaffle(drawTime);
  return drawTime;
}

async function fundPlayer(token, player) {
  await token.connect(player).faucet(); // 1,000 BNZ
}

async function buy(token, raffle, player, count) {
  const cost = BNZ(5) * BigInt(count);
  await token.connect(player).approve(await raffle.getAddress(), cost);
  await raffle.connect(player).buyTickets(count);
}

describe("BanzaiToken (BNZ)", function () {
  it("faucet mints 1,000 BNZ", async function () {
    const { token, players } = await deploy();
    await token.connect(players[0]).faucet();
    expect(await token.balanceOf(players[0].address)).to.equal(BNZ(1000));
  });

  it("faucet enforces a 24h cooldown per address", async function () {
    const { token, players } = await deploy();
    await token.connect(players[0]).faucet();
    await expect(token.connect(players[0]).faucet()).to.be.revertedWith(
      "BanzaiToken: faucet cooldown"
    );
    await ethers.provider.send("evm_increaseTime", [DAY]);
    await ethers.provider.send("evm_mine");
    await token.connect(players[0]).faucet();
    expect(await token.balanceOf(players[0].address)).to.equal(BNZ(2000));
  });

  it("different addresses can claim independently", async function () {
    const { token, players } = await deploy();
    await token.connect(players[0]).faucet();
    await token.connect(players[1]).faucet();
    expect(await token.balanceOf(players[1].address)).to.equal(BNZ(1000));
  });
});

describe("BanzaiRaffle — buying", function () {
  it("buys tickets, assigns sequential ids, grows the pot, counts players", async function () {
    const { owner, players, token, raffle } = await deploy();
    await startRound(raffle, owner);
    await fundPlayer(token, players[0]);
    await fundPlayer(token, players[1]);
    await buy(token, raffle, players[0], 3);
    await buy(token, raffle, players[1], 2);
    const r = await raffle.getRaffle(1);
    expect(r.totalTickets).to.equal(5);
    expect(r.pot).to.equal(BNZ(25));
    expect(r.playerCount).to.equal(2);
    expect(await raffle.getPlayerTickets(1, players[0].address)).to.deep.equal([1n, 2n, 3n]);
    expect(await raffle.getPlayerTickets(1, players[1].address)).to.deep.equal([4n, 5n]);
    expect(await raffle.ticketOwner(1, 4)).to.equal(players[1].address);
  });

  it("enforces max 20 tickets per player per round", async function () {
    const { owner, players, token, raffle } = await deploy();
    await startRound(raffle, owner);
    await fundPlayer(token, players[0]);
    await buy(token, raffle, players[0], 20);
    await expect(buy(token, raffle, players[0], 1)).to.be.revertedWith(
      "BanzaiRaffle: max 20 tickets per player"
    );
  });

  it("rejects buying 0 tickets", async function () {
    const { owner, players, token, raffle } = await deploy();
    await startRound(raffle, owner);
    await fundPlayer(token, players[0]);
    await expect(buy(token, raffle, players[0], 0)).to.be.revertedWith(
      "BanzaiRaffle: buy at least 1 ticket"
    );
  });

  it("rejects buying without BNZ approval", async function () {
    const { owner, players, token, raffle } = await deploy();
    await startRound(raffle, owner);
    await fundPlayer(token, players[0]);
    await expect(raffle.connect(players[0]).buyTickets(1)).to.be.revertedWithCustomError(
      token,
      "ERC20InsufficientAllowance"
    );
  });

  it("rejects buying after sales close", async function () {
    const { owner, players, token, raffle } = await deploy();
    await startRound(raffle, owner, 60);
    await fundPlayer(token, players[0]);
    await ethers.provider.send("evm_increaseTime", [61]);
    await ethers.provider.send("evm_mine");
    await expect(buy(token, raffle, players[0], 1)).to.be.revertedWith(
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
});

describe("BanzaiRaffle — draw & finalize", function () {
  it("rejects draw before drawTime; draw records seedBlock = block.number + 1", async function () {
    const { owner, players, token, raffle } = await deploy();
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
    const { owner, players, token, raffle } = await deploy();
    await startRound(raffle, owner, 60);
    // 5 players x 20 tickets = 100 tickets = 500 BNZ pot
    for (let i = 0; i < 5; i++) {
      await fundPlayer(token, players[i]);
      await buy(token, raffle, players[i], 20);
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
    const amounts = [BNZ(150), BNZ(90), BNZ(60), BNZ(100), BNZ(100)]; // 30/18/12%, 2x100, 0 remainder
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

  it("ASE-shape pot 7,275 BNZ pays 2182.5 / 1309.5 / 873 / 29x100 / 10", async function () {
    const { owner, players, token, raffle } = await deploy();
    // Seed the pot via rollover = 5,375 BNZ. All faucet claims happen BEFORE
    // the round opens (cooldowns need day jumps, which would close sales).
    await token.connect(owner).faucet();
    await ethers.provider.send("evm_increaseTime", [DAY]);
    await ethers.provider.send("evm_mine");
    await token.connect(owner).faucet(); // owner: 2,000 BNZ
    await token.connect(owner).transfer(await raffle.getAddress(), BNZ(2000));
    for (let i = 0; i < 3; i++) {
      await fundPlayer(token, players[i]);
      await token.connect(players[i]).transfer(await raffle.getAddress(), BNZ(1000));
    }
    await fundPlayer(token, players[3]);
    await token.connect(players[3]).transfer(await raffle.getAddress(), BNZ(375));
    // Re-fund players 0-3 after the cooldown, fund the rest.
    await ethers.provider.send("evm_increaseTime", [DAY]);
    await ethers.provider.send("evm_mine");
    for (let i = 0; i < 4; i++) await fundPlayer(token, players[i]);
    for (let i = 4; i < 19; i++) await fundPlayer(token, players[i]);
    await startRound(raffle, owner, 60);
    expect((await raffle.getRaffle(1)).pot).to.equal(BNZ(5375)); // rollover
    // 380 tickets (19 players x 20) = 1,900 BNZ -> pot 7,275
    for (let i = 0; i < 19; i++) {
      await buy(token, raffle, players[i], 20);
    }
    expect((await raffle.getRaffle(1)).pot).to.equal(BNZ(7275));
    await ethers.provider.send("evm_increaseTime", [61]);
    await ethers.provider.send("evm_mine");
    await raffle.draw();
    await ethers.provider.send("evm_mine");
    await raffle.finalize();
    const winners = await raffle.getWinners(1);
    expect(winners.length).to.equal(33); // 3 top + 29 lots + 1 remainder
    const prizes = winners.map((w) => w.prize);
    expect(prizes[0]).to.equal(BNZ(2182.5));
    expect(prizes[1]).to.equal(BNZ(1309.5));
    expect(prizes[2]).to.equal(BNZ(873));
    for (let i = 3; i < 32; i++) expect(prizes[i]).to.equal(BNZ(100));
    expect(prizes[32]).to.equal(BNZ(10));
    const total = prizes.reduce((a, b) => a + b, 0n);
    expect(total).to.equal(BNZ(7275)); // whole pot allocated
  });

  it("few tickets: only the top prizes that have tickets are paid; rest rolls over", async function () {
    const { owner, players, token, raffle } = await deploy();
    await startRound(raffle, owner, 60);
    await fundPlayer(token, players[0]);
    await buy(token, raffle, players[0], 2); // 10 BNZ pot, 2 tickets
    await ethers.provider.send("evm_increaseTime", [61]);
    await ethers.provider.send("evm_mine");
    await raffle.draw();
    await ethers.provider.send("evm_mine");
    await raffle.finalize();
    const winners = await raffle.getWinners(1);
    expect(winners.length).to.equal(2);
    expect(winners[0].prize).to.equal(BNZ(3)); // 30% of 10
    expect(winners[1].prize).to.equal(BNZ(1.8)); // 18% of 10
    // Unallocated 5.2 BNZ stays in the contract; next round starts with it.
    await raffle.connect(owner).startRaffle((await latestTimestamp()) + DAY);
    expect((await raffle.getRaffle(2)).pot).to.equal(BNZ(5.2));
  });

  it("zero-ticket round finalizes with no winners and the pot rolls over", async function () {
    const { owner, token, raffle } = await deploy();
    await token.connect(owner).faucet();
    await token.connect(owner).transfer(await raffle.getAddress(), BNZ(50));
    await startRound(raffle, owner, 60);
    expect((await raffle.getRaffle(1)).pot).to.equal(BNZ(50));
    await ethers.provider.send("evm_increaseTime", [61]);
    await ethers.provider.send("evm_mine");
    await raffle.draw();
    await ethers.provider.send("evm_mine");
    await raffle.finalize();
    expect((await raffle.getWinners(1)).length).to.equal(0);
    await raffle.connect(owner).startRaffle((await latestTimestamp()) + DAY);
    expect((await raffle.getRaffle(2)).pot).to.equal(BNZ(50));
  });

  it("missed 256-block finalize window: finalize reverts, re-draw rescues the round", async function () {
    const { owner, players, token, raffle } = await deploy();
    await startRound(raffle, owner, 60);
    await fundPlayer(token, players[0]);
    await buy(token, raffle, players[0], 5);
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
    // 5 tickets, 25 BNZ pot -> 4 prize slots (45/27/18/60 scaled: 7.5/4.5/3/10)
    expect((await raffle.getWinners(1)).length).to.equal(4);
  });
});

describe("BanzaiRaffle — claiming", function () {
  async function finalizedRound() {
    const { owner, players, token, raffle } = await deploy();
    await startRound(raffle, owner, 60);
    for (let i = 0; i < 3; i++) {
      await fundPlayer(token, players[i]);
      await buy(token, raffle, players[i], 10); // 30 tickets = 150 BNZ
    }
    await ethers.provider.send("evm_increaseTime", [61]);
    await ethers.provider.send("evm_mine");
    await raffle.draw();
    await ethers.provider.send("evm_mine");
    await raffle.finalize();
    return { owner, players, token, raffle };
  }

  it("winner claims and receives BNZ; double claim reverts", async function () {
    const { players, token, raffle } = await finalizedRound();
    const winners = await raffle.getWinners(1);
    const w0 = winners[0];
    // claim() pays ALL of the player's winning slots, so sum them.
    const total = winners
      .filter((w) => w.player === w0.player)
      .reduce((a, w) => a + w.prize, 0n);
    const before = await token.balanceOf(w0.player);
    await expect(raffle.connect(await ethers.getSigner(w0.player)).claim(1))
      .to.emit(raffle, "Claimed")
      .withArgs(1, w0.player, total);
    expect(await token.balanceOf(w0.player)).to.equal(before + total);
    await expect(
      raffle.connect(await ethers.getSigner(w0.player)).claim(1)
    ).to.be.revertedWithCustomError(raffle, "NothingToClaim");
  });

  it("non-winner claim reverts", async function () {
    const { players, raffle } = await finalizedRound();
    const winnerAddrs = new Set((await raffle.getWinners(1)).map((w) => w.player));
    const loser = players.find((p) => !winnerAddrs.has(p.address));
    // With 30 tickets and 5 prize slots, some players may hold no winning
    // ticket; if every player won, use a fresh address instead.
    const loserAddr = loser ? loser.address : (await ethers.getSigners())[19].address;
    const loserSigner = await ethers.getSigner(loserAddr);
    await expect(raffle.connect(loserSigner).claim(1)).to.be.revertedWithCustomError(
      raffle,
      "NothingToClaim"
    );
  });

  it("prizes never expire: claiming works a year later", async function () {
    const { players, token, raffle } = await finalizedRound();
    const winners = await raffle.getWinners(1);
    const w0 = winners[0];
    const total = winners
      .filter((w) => w.player === w0.player)
      .reduce((a, w) => a + w.prize, 0n);
    await ethers.provider.send("evm_increaseTime", [365 * DAY]);
    await ethers.provider.send("evm_mine");
    const before = await token.balanceOf(w0.player);
    await raffle.connect(await ethers.getSigner(w0.player)).claim(1);
    expect(await token.balanceOf(w0.player)).to.equal(before + total);
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
