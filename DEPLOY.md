# BANZAI VEGAS (QoreChain) — deploy guide

Testnet only. No mainnet, no real funds. The operator is a fresh testnet-only
account — never Toni's main wallet, never the QoreX "Ethereum account"
0x4bbc… (the Fest checker rejects deployments from it). Never attempt
QoreSeal (blocked by design).

## 1. Operator identity (once)

```bash
npm install
node scripts/setup-operator.mjs
```

Prints the operator's public addresses — `qor1…` (native) + `0x…` (EVM) —
and writes the mnemonic ONLY to `.env.local` (mode 0600, gitignored). It is
never printed and never committed.

## 2. Fund the operator (Toni's step — faucet needs email sign-in)

Claim the QoreChain faucet for the operator's `qor1…` address:

- https://dashboard.qorechain.io/faucet — 100 QOR + 1000 fUSD + 0.5 fETH + 0.02 fBTC per claim, 1×/24h per account AND per address.
- 100 QOR is far more than the deploy needs (see gas below).

## 3. Register the PQC key (once, after funding)

```bash
node scripts/register-operator.mjs
```

Registers the operator's ML-DSA-87 key on chain (`MsgRegisterPQCKeyV2`,
classical-signed, bootstrap-exempt) and verifies it with a fresh REST read.
Idempotent — if already registered it sends nothing. Fails cleanly with
"operator unfunded" when the balance is 0.

## 4. Deploy (after the PQC key is registered)

```bash
npx hardhat compile
node scripts/deploy-qorechain.mjs
```

What it does, in order (all native txs are simulate-first; a failed
simulation sends nothing):

1. Hybrid-signed proof tx — 0.001 QOR to self (the explicit hybrid-signature
   proof for the Fest form).
2. Opens a scoped EVM window (600 blocks / 10 txs / 2 QOR max) with a
   hybrid-signed `MsgOpenEVMWindow`, then verifies it is live. Opening the
   window advances the EVM nonce — the EVM txs are signed after this.
3. Deploys `BanzaiRaffle` (QOR-native, no constructor args, no token) via
   viem, inside the window. Its max fees are checked against the window's
   remaining value BEFORE the deploy — if they don't fit, it aborts with no
   EVM tx sent.
4. Starts raffle #1 (draw = next day 20:00 UTC).

Outputs:

- `frontend/deployed-addresses.json` — the addresses the frontend reads.
- `deployment.json` — receipt with every tx hash + explorer link (gitignored;
  keep it private-ish: it holds no secrets, only public hashes).

### Gas (measured on the BNZ version's local runs; the QOR raffle has no token deploy and no constructor args, so it is cheaper)

| Step | Gas (local estimate) |
|---|---|
| Deploy BanzaiRaffle | ~2,400,000 (was ~2,613,053 with the token-arg constructor) |
| startRaffle | ~81,417 |
| Full deploy end-to-end | ~2,500,000 |

At QoreChain EVM gas prices this is well under 1 QOR for the whole deploy;
the 100 QOR faucet claim covers it many times over. Exact QOR spent is in
`deployment.json` after a real deploy.

> **Retired BNZ deploy (21 Nov 2026, abandoned):** token 0x3d1c5dad2b1a11b7dda71365fdc2e66a97ce1a5d + raffle 0x2457ba1f2acdfd7015ceeb4c350b237cea5e3178, raffle #1 started, draw Sun 22 Nov 20:00 UTC, pot 0, no tickets sold. Do not redeploy over it without `--force`; the QOR redeploy replaces it entirely.

### Re-deploy

`deploy-qorechain.mjs` refuses when `frontend/deployed-addresses.json`
already holds real QoreChain addresses. Re-run with `--force` to redeploy
(the old addresses are then abandoned).

## 5. Frontend (GitHub Pages)

The frontend is a static site (`frontend/`, no build step), live at
https://agusher21.github.io/banzai-vegas-qorechain/ via the `gh-pages`
branch (frontend files at root). Publish with a worktree:

```bash
git fetch origin
git worktree add /tmp/bv-pages gh-pages
cp frontend/* /tmp/bv-pages/
cd /tmp/bv-pages && git add -A && git commit -m "Publish QOR frontend" && git push origin gh-pages
git worktree remove /tmp/bv-pages
```

Until the QOR raffle is deployed, the frontend shows "NOT DEPLOYED YET".
Once `deployed-addresses.json` holds the real QOR raffle address (written
by the deploy script, committed + pushed), the frontend reads the chain
live. The BNZ version was retired 21 Nov 2026 — the live site currently
shows NOT DEPLOYED YET until the QOR redeploy lands.

(Vercel import is no longer needed — GitHub Pages is the live demo URL.)

## 6. Fest "Create project" form

The form does NOT save drafts — fill every field in one session. All fields
are prepared in `FEST_FIELDS.md`. The demo video (≤3 min) is STALE — it shows
the BNZ version; re-record it after the QOR redeploy, then fill the form.
