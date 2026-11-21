# BANZAI VEGAS — demo video shot list (≤3 min, for the QoreChain Fest project form)

Live site: https://agusher21.github.io/banzai-vegas-qorechain/
Repo: https://github.com/agusher21/banzai-vegas-qorechain
Contracts (qorechain-diana, EVM 9800): raffle 0x24f9cffaf5334b2bae7a2da0c5fd8e6dffbc291e.
NO token — tickets are 5 native QOR each. Raffle #1 OPEN, first draw
Sun 22 Nov 20:00 UTC, then DAILY 20:00 UTC.

## Shots (record the live site in a browser, 1920×1080)

1. **Opening — the live site.** Pot, countdown to the draw, tickets sold,
   players. Show raffle #1 is OPEN. (New design: 220px casino banner,
   YOUR LUCKY TICKET box below the pot, Bebas Neue font.)
2. **How it works — ticket picker.** 5 QOR per ticket, max 20 per player per
   round; picker 1 / 2 / 5 / Max; prizes 1st 30%, 2nd 18%, 3rd 12% + lucky lots.
3. **Free QOR — the faucet.** Claim 100 QOR per claim, once a day
   (testnet only) — the #how section.
4. **Buy a ticket.** Connect wallet — the picker modal (MetaMask, QoreX,
   WalletConnect, Coinbase, Brave, OKX). **Record up to the wallet picker
   prompt ONLY — no tx, no signature, no faucet claim.**
5. **Post-quantum operator.** Show the explorer: raffle address page
   (EVM deploy txs are NOT indexed on the /tx/ route — show the address
   page instead), PQC ML-DSA-87 registration tx
   (78C826BC8F66912012F64497E820D05E7290DF0749F1CCE4619973F5CC0CB747),
   hybrid-signed window-open tx
   (054447E3A88312DE9A62BAA0C771EEAEFD6341B265A94A6862810AC2A5650310).
   One line: the deploys ran inside a hybrid-signed (secp256k1 + ML-DSA-87)
   EVM window.
6. **Closing.** Draws every day at 20:00 UTC (first Sun 22 Nov);
   prizes never expire; repo link.

## Narration draft (~135 words, English, ~44s at speed 130)

> Banzai Vegas is an on-chain raffle on the QoreChain testnet. Buy QOR
> tickets — five QOR each, up to twenty per round — and win the pot: thirty
> percent for first place, eighteen for second, twelve for third, plus lucky
> lots. Draws run every day at twenty hundred UTC, automatic. QOR is free
> on testnet: the faucet gives you a hundred QOR a day. To play, connect
> your wallet on the QoreChain testnet and buy your tickets. What makes
> this post-quantum: the operator runs on an ML-DSA-87 key registered on
> chain, and every deploy ran inside a hybrid-signed EVM window — secp256k1
> plus ML-DSA-87. The contracts are live, raffle number one is open, and
> the first draw is Sunday the twenty-second of November at twenty hundred
> UTC. Try it at the link below — testnet only, no real funds.

## Status

- Shot list + narration: QOR version (this file). Old BNZ version superseded.
- **Old video (BNZ, STALE):** `banzai-vegas-demo.mp4` — 44.1s, 1920×1080,
  30fps, H.264+AAC, 1,331,755 bytes. Narration 44.0s, Helio
  (avocado_v2:MAI_03) speed 130, 136 words. Recorded 21 Nov ~15:43 WIB.
  Shot 4 was the wallet prompt only ("MetaMask not found — install it to
  play."), no tx, no signature, no faucet claim. Pot was 0 BNZ at record
  time — real state, shown as-is. Shot 5 used the raffle account + PQC
  registration tx (MsgRegisterPQCKeyV2, key type hybrid, block #10,479,336).
  The token-deploy EVM tx is NOT shown: the explorer's /tx/ route does not
  index EVM txs ("Transaction not found" on testnet even with the correct
  hash). Explorer defaults to Mainnet — capture clicks the Testnet pill
  (proxy.js + --ignore-certificate-errors needed for Playwright through the
  egress proxy; see capture.js/proxy.js).
- **QOR re-record:** `banzai-vegas-demo-qor.mp4` (see capture-qor.js /
  assemble-qor.py / shots-qor/). Same pipeline, QOR content: 5 QOR/ticket,
  QOR faucet 100/24h, draws DAILY 20:00 UTC, raffle
  0x24f9cffaf5334b2bae7a2da0c5fd8e6dffbc291e, first draw Sun 22 Nov
  20:00 UTC. Shot 4 is the wallet picker modal only. Shot 5 shows the
  raffle address page + PQC tx + window-open tx (both native, indexed).
- Next: upload the QOR video to YouTube (Public or Unlisted) and paste the
  URL into the Fest Create-project form.
