# BANZAI VEGAS — on-chain raffle on QoreChain testnet

**Post-quantum dApp for the QoreChain Developer Fest 'Build Before Q-Day'.** Buy BNZ raffle tickets on the QoreChain testnet (qorechain-diana, EVM chain 9800), win the pot. Draws every Sunday, Tuesday and Thursday at 20:00 UTC. Testnet only — no real money.

> This is the QoreChain port of BANZAI VEGAS. The earlier Base Sepolia version (repo `agusher21/banzai-vegas`) was abandoned by the owner's word — this repo is the one that counts.

## How it works

1. **Get QOR for gas** from the [QoreChain faucet](https://dashboard.qorechain.io/faucet) (100 QOR per claim, 1×/24h per address).
2. **Claim free BNZ** from the in-app faucet (1,000 BNZ, once a day, testnet only).
3. **Buy tickets** — 5 BNZ each, up to 20 per raffle. Sales close at draw time.
4. **Draw** — after sales close, anyone can start the draw. Winners are picked from a future blockhash — public and verifiable on-chain. 1st gets 30%, 2nd 18%, 3rd 12%, then up to 29 lucky lots of 100 BNZ plus one lot of the remainder.
5. **Claim** your prize from "My wins". Prizes never expire.

## Post-quantum, for real

The raffle operator is a **fresh testnet-only unified QoreChain account** (native `qor1…` + EVM `0x…` from one mnemonic):

- Its **ML-DSA-87 key is registered on chain** (`MsgRegisterPQCKeyV2`, verified via REST).
- The EVM window that admits the deploys is opened by a **hybrid-signed** `MsgOpenEVMWindow` (secp256k1 + ML-DSA-87).
- Every native tx the operator sends is **hybrid-signed**; every EVM tx runs inside a scoped window (600 blocks / 10 txs / 2 QOR max).
- The raffle itself is a plain EVM contract — the post-quantum part is the operator: no one picks winners, and the deploys are gated by a hybrid-signed window.

See `scripts/` for the operator flow (setup → register → deploy) and `DEPLOY.md` for the exact commands and the deployment receipt.

## Contracts (QoreChain testnet, EVM 9800)

- `BanzaiToken` (BNZ) — ERC-20 play token + faucet (1,000 BNZ / address / 24h, 100M cap, no owner mint).
- `BanzaiRaffle` — buy (5 BNZ/ticket, max 20/player/round) / draw / finalize / claim / rollover. Only `startRaffle` is owner-only; no owner withdrawal, no owner-picks-winner.

Randomness is a two-step future-blockhash draw (public, verifiable; 256-block finalize window with re-draw rescue). It is fair for a testnet game, not for high-value production — the named upgrade is Chainlink VRF where available on the target chain.

Deployed addresses (after `node scripts/deploy-qorechain.mjs`): see `frontend/deployed-addresses.json` and `deployment.json`.

## Run the frontend locally

```bash
cd frontend
python3 -m http.server 8000
# open http://localhost:8000 — reads work without a wallet;
# buying/claiming need MetaMask on QoreChain testnet (chain 9800).
```

Live demo: see the repo's Vercel deployment (Root Directory `frontend`, static site, no build step) — or import the repo in the Vercel dashboard.

## Develop

```bash
npm install
npx hardhat compile
npx hardhat test          # 20 tests — contracts, draw/finalize, claims, rollover
node scripts/setup-operator.mjs     # once: fresh testnet-only operator account
node scripts/register-operator.mjs  # once, after funding it from the faucet
node scripts/deploy-qorechain.mjs   # deploy + start raffle #1
```

## QoreChain kit

- **QoreChain SDK** (`@qorechain/sdk` ^0.14.0) — in `package.json`, used by `scripts/` for the unified account, PQC registration, hybrid signing and the EVM window. This is the kit the Fest platform detects.
- **Hybrid-signed txs on testnet** — the operator's proof tx + EVM-window open (hashes in `deployment.json` after deploy).

## Fest

- Category: **Post-Quantum dApp**
- Fest: QoreChain Developer Fest 'Build Before Q-Day' — operative deadline 25 Nov 2026 08:00 UTC (page says 2 Dec 23:59 UTC).
- The Fest "Create project" form does not save drafts — all fields are listed in `FEST_FIELDS.md`.

## License

MIT — see `LICENSE`.
