// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title Banzai Token (BNZ) — RETIRED 21 Nov 2026, do not use.
/// @notice The raffle now takes native QOR for tickets AND payouts, so no
/// play token is needed. This contract is kept in the repo for history only:
/// the token deployed at 0x3d1c5dad2b1a11b7dda71365fdc2e66a97ce1a5d (QoreChain
/// testnet) is abandoned with the BNZ raffle. It still compiles, but nothing
/// in the raffle, the frontend or the deploy script references it anymore.
/// @notice Testnet ONLY. No real value.
contract BanzaiToken is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 1_000 ether; // 1,000 BNZ per claim
    uint256 public constant FAUCET_COOLDOWN = 1 days;
    uint256 public constant MAX_FAUCET_SUPPLY = 100_000_000 ether; // faucet stops here

    uint256 public totalFaucetMinted;
    mapping(address => uint256) public lastFaucetClaim;

    event FaucetClaimed(address indexed claimer, uint256 amount);

    constructor() ERC20("Banzai", "BNZ") {}

    /// @notice Claim 1,000 BNZ. One claim per address per 24h, until the
    /// global faucet supply cap is reached.
    function faucet() external {
        require(
            block.timestamp >= lastFaucetClaim[msg.sender] + FAUCET_COOLDOWN,
            "BanzaiToken: faucet cooldown"
        );
        require(
            totalFaucetMinted + FAUCET_AMOUNT <= MAX_FAUCET_SUPPLY,
            "BanzaiToken: faucet supply exhausted"
        );
        lastFaucetClaim[msg.sender] = block.timestamp;
        totalFaucetMinted += FAUCET_AMOUNT;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);
    }
}
