# BANZAI VEGAS — Fest "Create project" form fields

The QoreChain Fest project form does NOT save drafts — fill everything in
ONE session. This file lists every field, prepared, so the form can be
completed in one pass. Category: **Post-Quantum dApp**.

## Project

- **Name:** BANZAI VEGAS
- **Description:** On-chain raffle on the QoreChain testnet. Buy QOR tickets (5 QOR, max 20 per round), win the pot — 1st 30%, 2nd 18%, 3rd 12% + lucky lots. Tickets and payouts all in native QOR (get QOR from the QoreChain faucet, 100 QOR/day). Draws every day 20:00 UTC, automatic. Post-quantum operator: ML-DSA-87 key registered on chain, hybrid-signed (secp256k1 + ML-DSA-87) EVM window opens the deploys. Testnet only.
- **Category:** Post-Quantum dApp
- **Public GitHub repository:** https://github.com/agusher21/banzai-vegas-qorechain (MIT)
- **README:** in the repo (how it works, post-quantum operator, run instructions, kit).
- **Cover image (16:9, ≥1200×675):** `cover.png` in the repo (1280×720).
- **Video (up to 3 minutes):** STALE — the 44s demo shows the BNZ version. Re-record after the QOR redeploy (live site + a QOR ticket buy + the hybrid-signed window).
- **Live demo URL:** https://agusher21.github.io/banzai-vegas-qorechain/ — LIVE (GitHub Pages, gh-pages branch). QOR frontend published 21 Nov ~16:xx WIB; shows NOT DEPLOYED YET until the QOR raffle is redeployed. No Vercel needed.
- **Testnet address the project uses:** operator `qor1kekl6q0utmkzfa74n3esajj5rtwuh5gsdh4gvh` / EVM `0xb66DFD01Fc5eEC24f7d59c730ECA541addcbd110`.
- **Hybrid-signed tx:** PQC registration `78C826BC8F66912012F64497E820D05E7290DF0749F1CCE4619973F5CC0CB747`; window-open `08FE118300B7C56BC9DB3446539AA13DDB0CCA9361EC7C8CEA1E32B9E8F06E81` (run 7) and `A096015AF858F6BAAC34DBB2D435AABCBD896BCD1C8463A36C0FD02F31B6B4B4` (phase A). **BNZ-version deploy txs (RETIRED 21 Nov, superseded by the QOR redeploy):** token deploy `0x8409dea54c33a0e8381502db7fbfb059b89dde343721cb5c2d01260c704e28ae`; raffle deploy `0x1c026d8dd3e551c9397bfa6822d77f694fef44c106b856dbbd1f001b63f3430a`; startRaffle `0x63f3581b7847bf6941d799b014abe52c9051edecfb18d0773faa4a3c57a32882` (raffle 0x2457…, token 0x3d1c…). Full receipt in `deployment.json` (regenerated on redeploy).
- **Team:** solo (Toni Banzai, agusher21). Post-Quantum dApp allows solo.

## QoreChain kit (what the platform detects)

- **QoreChain SDK** (`@qorechain/sdk` ^0.14.0) — in `package.json`, used by `scripts/` for the unified account, PQC registration, hybrid signing and the EVM window. Expected: VERIFIED.
- **Hybrid signatures** — proven on testnet by the operator's hybrid-signed txs (proof tx + window open). Expected: VERIFIED.
- **ML-DSA-87** — PQC key registered on chain for the operator address. Expected: VERIFIED (via the PQC status read).
- **Smart accounts** — NOT used by this project (no spending-policy agent). Do not claim it.

## Status (as of the last build)

- [x] Repo public (MIT) + README + cover image
- [x] Contracts written + 20/20 local tests passing (QOR-native, 21 Nov)
- [x] Operator identity script + PQC registration script + deploy script (QOR raffle-only)
- [x] Frontend (static, chain 9800, reads work wallet-less) — QOR version, with animated ticket card after purchase
- [x] Operator funded (faucet claim 100 QOR, verified on-chain 21 Nov ~13:57 WIB)
- [x] PQC key registered on chain (tx 78C826BC…, ML-DSA-87)
- [x] BNZ contracts deployed on qorechain-diana + raffle #1 started (21 Nov ~15:03 WIB) — **RETIRED 21 Nov, superseded by the QOR refactor**
- [x] Hybrid-signed tx hash on testnet (PQC + window-open + deploys, see above)
- [x] Live demo URL (GitHub Pages — QOR frontend published 21 Nov, shows NOT DEPLOYED YET until the QOR redeploy)
- [ ] QOR raffle redeployed + raffle #1 started (needs Toni's correction first, then --force deploy)
- [ ] Demo video ≤3 min re-recorded (the 44s video shows the BNZ version — stale)
- [ ] Fest "Create project" form submitted (fill in one session, signed in as Toni; all fields ready above)
