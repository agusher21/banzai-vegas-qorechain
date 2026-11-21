# BANZAI VEGAS — Fest "Create project" form fields

The QoreChain Fest project form does NOT save drafts — fill everything in
ONE session. This file lists every field, prepared, so the form can be
completed in one pass. Category: **Post-Quantum dApp**.

## Project

- **Name:** BANZAI VEGAS
- **Description:** On-chain raffle on the QoreChain testnet. Buy BNZ tickets (5 BNZ, max 20 per round), win the pot — 1st 30%, 2nd 18%, 3rd 12% + lucky lots. Draws Sun/Tue/Thu 20:00 UTC. Post-quantum operator: ML-DSA-87 key registered on chain, hybrid-signed (secp256k1 + ML-DSA-87) EVM window opens the deploys. Testnet only.
- **Category:** Post-Quantum dApp
- **Public GitHub repository:** https://github.com/agusher21/banzai-vegas-qorechain (MIT)
- **README:** in the repo (how it works, post-quantum operator, run instructions, kit).
- **Cover image (16:9, ≥1200×675):** `cover.png` in the repo (1280×720).
- **Video (up to 3 minutes):** TODO — Toni records it (demo of the live site + a ticket buy + the hybrid-signed window). Not yet recorded.
- **Live demo URL:** TODO — Vercel import pending (see DEPLOY.md §5). Dashboard import: repo `agusher21/banzai-vegas-qorechain`, Root Directory `frontend`.
- **Testnet address the project uses:** the operator's `qor1…` address (printed by `node scripts/setup-operator.mjs`, after funding). EVM address `0x…` (same account).
- **Hybrid-signed tx:** the proof tx + EVM-window-open tx hashes from `deployment.json` (after `node scripts/deploy-qorechain.mjs`).
- **Team:** solo (Toni Banzai, agusher21). Post-Quantum dApp allows solo.

## QoreChain kit (what the platform detects)

- **QoreChain SDK** (`@qorechain/sdk` ^0.14.0) — in `package.json`, used by `scripts/` for the unified account, PQC registration, hybrid signing and the EVM window. Expected: VERIFIED.
- **Hybrid signatures** — proven on testnet by the operator's hybrid-signed txs (proof tx + window open). Expected: VERIFIED.
- **ML-DSA-87** — PQC key registered on chain for the operator address. Expected: VERIFIED (via the PQC status read).
- **Smart accounts** — NOT used by this project (no spending-policy agent). Do not claim it.

## Status (as of the last build)

- [x] Repo public (MIT) + README + cover image
- [x] Contracts written + 20/20 local tests passing
- [x] Operator identity script + PQC registration script + deploy script
- [x] Frontend (static, chain 9800, reads work wallet-less)
- [ ] Operator funded (faucet claim — Toni's step)
- [ ] PQC key registered on chain (after funding)
- [ ] Contracts deployed on qorechain-diana + raffle #1 started (after funding)
- [ ] Hybrid-signed tx hash on testnet (after deploy)
- [ ] Live demo URL (Vercel dashboard import — Toni's step)
- [ ] Demo video ≤3 min (Toni's step)
- [ ] Fest "Create project" form submitted (Toni fills it in one session)
