// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title BanzaiRaffle — on-chain raffle, ASE Vegas formula, QoreChain testnet (qorechain-diana, EVM 9800)
/// @notice Testnet ONLY. No real value anywhere in this contract.
///
/// Tickets AND prizes are paid in native QOR (the QoreChain testnet token),
/// so anyone with faucet QOR can play — no play token needed.
///
/// MECHANICS (mirrors the ASE Vegas raffle in the reference screenshot):
///  - Ticket price: 5 QOR. Max 20 tickets per player per raffle.
///  - Sales close at drawTime (draws run Sunday / Tuesday / Thursday 20:00 UTC;
///    the weekday is a convention of the operator, not enforced on-chain).
///  - Pot = all QOR collected in the round, plus any rollover from unallocated
///    prizes of earlier rounds.
///  - Prizes, computed from the pot at finalize time:
///      1st 30%, 2nd 18%, 3rd 12%,
///      then up to 29 lucky lots of exactly 100 QOR,
///      then ONE lucky lot of whatever remains.
///    Example: pot 7,276 QOR -> 1st 2,182.80, 2nd 1,309.68, 3rd 873.12,
///    29 x 100 QOR, remainder lot 10.40 QOR (exactly the ASE #12 shape).
///  - Prizes NEVER expire. Winners claim any time via claim().
///  - Any prize slot that has no ticket to pay (too few tickets sold) is
///    simply not paid; its amount stays in the contract and rolls into the
///    next round's pot.
///
/// RANDOMNESS — read this honestly:
///  - Winners are picked from a future blockhash: draw() (callable by anyone
///    after drawTime) records seedBlock = block.number + 1; finalize()
///    (callable by anyone once that block is mined) uses blockhash(seedBlock)
///    as the seed and a Fisher-Yates partial shuffle to pick distinct winning
///    tickets. The seed is public and verifiable on-chain; the owner cannot
///    pick winners.
///  - LIMITS: a blockhash is only available for the most recent 256 blocks,
///    so finalize() must run within 256 blocks of the draw. If the window is
///    missed, anyone may call draw() again to set a fresh seedBlock. A block
///    producer can influence a blockhash to a small degree (and on a testnet
///    this is cheap); this scheme is fair for a testnet game, NOT for a
///    high-value production raffle. The production upgrade path is Chainlink
///    VRF where available on the target chain (not wired for qorechain-diana
///    yet — needs a VRF subscription + LINK on this chain).
///  - The only owner-only function is startRaffle(). There is no owner
///    withdrawal and no way for anyone to choose winners.
contract BanzaiRaffle is ReentrancyGuard {
    address public immutable owner;

    uint256 public constant TICKET_PRICE = 5 ether; // 5 QOR
    uint256 public constant MAX_TICKETS_PER_PLAYER = 20;
    uint256 public constant LUCKY_LOT = 100 ether; // 100 QOR
    uint256 public constant MAX_LUCKY_LOTS = 29;
    uint256 public constant FIRST_PCT = 30;
    uint256 public constant SECOND_PCT = 18;
    uint256 public constant THIRD_PCT = 12;

    enum State {
        OPEN,
        DRAWING,
        FINALIZED
    }

    struct Winner {
        address player;
        uint256 ticketId;
        uint256 prize;
        bool claimed;
    }

    struct Raffle {
        uint256 drawTime;
        uint256 pot;
        uint256 totalTickets;
        uint256 playerCount;
        uint256 seedBlock;
        State state;
    }

    uint256 public currentRaffleId;
    mapping(uint256 => Raffle) public raffles;
    // ticketId (1-based, per round) -> player
    mapping(uint256 => mapping(uint256 => address)) public ticketOwner;
    // round -> player -> ticket ids
    mapping(uint256 => mapping(address => uint256[])) public playerTickets;
    mapping(uint256 => Winner[]) public winners;
    // QOR currently owed to winners across all rounds (unclaimed prizes)
    uint256 public totalUnclaimed;

    event RaffleStarted(uint256 indexed raffleId, uint256 drawTime, uint256 rollover);
    event TicketsBought(uint256 indexed raffleId, address indexed buyer, uint256 count, uint256 firstTicketId);
    event DrawStarted(uint256 indexed raffleId, uint256 seedBlock);
    event RaffleFinalized(uint256 indexed raffleId, bytes32 seed, uint256 winnerCount, uint256 allocated);
    event Claimed(uint256 indexed raffleId, address indexed winner, uint256 amount);

    error NotOwner();
    error NotOpen();
    error NotDrawing();
    error NothingToClaim();
    error InvalidDrawTime();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Accept plain QOR transfers (e.g. a manual rollover seed).
    /// Plain transfers are NOT ticket purchases — they just sit in the
    /// contract balance and roll into the next round's pot.
    receive() external payable {}

    /// @notice Open a new round. drawTime must be in the future. Any QOR left
    /// in the contract that is not owed to winners rolls into the new pot.
    function startRaffle(uint256 drawTime) external onlyOwner {
        if (drawTime <= block.timestamp) revert InvalidDrawTime();
        if (currentRaffleId != 0) {
            require(
                raffles[currentRaffleId].state == State.FINALIZED,
                "BanzaiRaffle: previous round not finalized"
            );
        }
        uint256 rollover = address(this).balance - totalUnclaimed;
        currentRaffleId += 1;
        Raffle storage r = raffles[currentRaffleId];
        r.drawTime = drawTime;
        r.pot = rollover;
        r.state = State.OPEN;
        emit RaffleStarted(currentRaffleId, drawTime, rollover);
    }

    /// @notice Buy `count` tickets in the current round. Send exactly
    /// count * TICKET_PRICE QOR with the call — no approval, no token.
    function buyTickets(uint256 count) external payable nonReentrant {
        Raffle storage r = raffles[currentRaffleId];
        if (r.state != State.OPEN) revert NotOpen();
        require(block.timestamp < r.drawTime, "BanzaiRaffle: sales closed");
        require(count >= 1, "BanzaiRaffle: buy at least 1 ticket");
        uint256 already = playerTickets[currentRaffleId][msg.sender].length;
        require(
            already + count <= MAX_TICKETS_PER_PLAYER,
            "BanzaiRaffle: max 20 tickets per player"
        );
        uint256 cost = count * TICKET_PRICE;
        require(msg.value == cost, "BanzaiRaffle: send exactly count * 5 QOR");
        uint256 firstTicketId = r.totalTickets + 1;
        if (already == 0) r.playerCount += 1;
        for (uint256 i = 0; i < count; i++) {
            uint256 ticketId = r.totalTickets + 1;
            ticketOwner[currentRaffleId][ticketId] = msg.sender;
            playerTickets[currentRaffleId][msg.sender].push(ticketId);
            r.totalTickets += 1;
        }
        r.pot += cost;
        emit TicketsBought(currentRaffleId, msg.sender, count, firstTicketId);
    }

    /// @notice Start the draw. Callable by anyone after drawTime. Records the
    /// block whose hash will seed the winners. If a previous draw's 256-block
    /// finalize window was missed, anyone may call this again for a fresh seed.
    function draw() external {
        Raffle storage r = raffles[currentRaffleId];
        require(block.timestamp >= r.drawTime, "BanzaiRaffle: sales still open");
        if (r.state == State.OPEN) {
            r.state = State.DRAWING;
        } else {
            require(r.state == State.DRAWING, "BanzaiRaffle: already finalized");
            require(
                block.number > r.seedBlock + 255,
                "BanzaiRaffle: finalize window still open"
            );
        }
        r.seedBlock = block.number + 1;
        emit DrawStarted(currentRaffleId, r.seedBlock);
    }

    /// @notice Pick the winners from blockhash(seedBlock). Callable by anyone
    /// once the seed block is mined and within 256 blocks of it.
    function finalize() external {
        Raffle storage r = raffles[currentRaffleId];
        if (r.state != State.DRAWING) revert NotDrawing();
        require(block.number > r.seedBlock, "BanzaiRaffle: seed block not mined");
        require(
            block.number <= r.seedBlock + 255,
            "BanzaiRaffle: seed expired, call draw() again"
        );
        bytes32 seed = blockhash(r.seedBlock);
        uint256 pot = r.pot;
        uint256 t = r.totalTickets;

        // Prize amounts, in order. Slots with no ticket are skipped and their
        // amount rolls over to the next round.
        uint256[] memory amounts = new uint256[](3 + MAX_LUCKY_LOTS + 1);
        uint256 slotCount = 0;
        if (t >= 1) amounts[slotCount++] = (pot * FIRST_PCT) / 100;
        if (t >= 2) amounts[slotCount++] = (pot * SECOND_PCT) / 100;
        if (t >= 3) amounts[slotCount++] = (pot * THIRD_PCT) / 100;
        uint256 remainder = pot - ((pot * FIRST_PCT) / 100) - ((pot * SECOND_PCT) / 100) - ((pot * THIRD_PCT) / 100);
        uint256 fixedLots = remainder / LUCKY_LOT;
        if (fixedLots > MAX_LUCKY_LOTS) fixedLots = MAX_LUCKY_LOTS;
        for (uint256 i = 0; i < fixedLots; i++) {
            amounts[slotCount++] = LUCKY_LOT;
        }
        uint256 remainderLot = remainder - fixedLots * LUCKY_LOT;
        if (remainderLot > 0) amounts[slotCount++] = remainderLot;

        // Fisher-Yates partial shuffle over ticket ids 1..t, seeded by `seed`.
        uint256[] memory ids = new uint256[](t);
        for (uint256 i = 0; i < t; i++) ids[i] = i + 1;
        uint256 allocated = 0;
        uint256 slots = slotCount < t ? slotCount : t;
        for (uint256 i = 0; i < slots; i++) {
            uint256 rand = uint256(keccak256(abi.encode(seed, i)));
            uint256 j = i + (rand % (t - i));
            (ids[i], ids[j]) = (ids[j], ids[i]);
            uint256 ticketId = ids[i];
            address player = ticketOwner[currentRaffleId][ticketId];
            uint256 prize = amounts[i];
            winners[currentRaffleId].push(
                Winner({player: player, ticketId: ticketId, prize: prize, claimed: false})
            );
            allocated += prize;
        }
        totalUnclaimed += allocated;
        r.state = State.FINALIZED;
        emit RaffleFinalized(currentRaffleId, seed, slots, allocated);
    }

    /// @notice Claim ALL of the caller's unclaimed prizes in a round.
    /// Prizes never expire — there is no deadline on this call.
    /// Pays out in native QOR.
    function claim(uint256 raffleId) external nonReentrant {
        uint256 amount = 0;
        Winner[] storage ws = winners[raffleId];
        for (uint256 i = 0; i < ws.length; i++) {
            if (ws[i].player == msg.sender && !ws[i].claimed) {
                ws[i].claimed = true;
                amount += ws[i].prize;
            }
        }
        if (amount == 0) revert NothingToClaim();
        totalUnclaimed -= amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "BanzaiRaffle: QOR payout failed");
        emit Claimed(raffleId, msg.sender, amount);
    }

    // ---- views ----

    function claimable(uint256 raffleId, address player) external view returns (uint256) {
        uint256 amount = 0;
        Winner[] storage ws = winners[raffleId];
        for (uint256 i = 0; i < ws.length; i++) {
            if (ws[i].player == player && !ws[i].claimed) amount += ws[i].prize;
        }
        return amount;
    }

    function getPlayerTickets(uint256 raffleId, address player) external view returns (uint256[] memory) {
        return playerTickets[raffleId][player];
    }

    function getWinners(uint256 raffleId) external view returns (Winner[] memory) {
        return winners[raffleId];
    }

    function getRaffle(uint256 raffleId) external view returns (Raffle memory) {
        return raffles[raffleId];
    }
}
