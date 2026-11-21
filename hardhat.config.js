require("@nomicfoundation/hardhat-chai-matchers");
require("@nomicfoundation/hardhat-ethers");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.24",
  networks: {
    hardhat: {},
    qorechain: {
      // QoreChain testnet (qorechain-diana) EVM — chain 9800.
      // The deploy script (scripts/deploy-qorechain.mjs) uses viem + the
      // operator key from .env.local, NOT this accounts list. This entry
      // exists so `npx hardhat run --network qorechain` works if needed.
      url: "https://evm-testnet.qore.host",
      chainId: 9800,
      accounts: process.env.QORECHAIN_DEPLOYER_KEY
        ? [process.env.QORECHAIN_DEPLOYER_KEY]
        : [],
    },
  },
};
