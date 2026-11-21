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
3. Deploys `BanzaiToken` + `BanzaiRaffle` via viem, inside the window. Their
   max fees are checked against the window's remaining value BEFORE the first
   deploy — if they don't fit, it aborts with no EVM tx sent.
4. Starts raffle #1 (draw = next Sun/Tue/Thu 20:00 UTC).

Outputs:

- `frontend/deployed-addresses.json` — the addresses the frontend reads.
- `deployment.json` — receipt with every tx hash + explorer link (gitignored;
  keep it private-ish: it holds no secrets, only public hashes).

### Gas (measured on the Base Sepolia version's local runs; QoreChain EVM will differ slightly)

| Step | Gas (local estimate) |
|---|---|
| Deploy BanzaiToken | ~1,155,590 |
| Deploy BanzaiRaffle | ~2,613,053 |
| startRaffle | ~81,417 |
| Full round end-to-end | ~4,966,500 |

At QoreChain EVM gas prices this is well under 1 QOR for the whole deploy;
the 100 QOR faucet claim covers it many times over. Exact QOR spent is in
`deployment.json` after a real deploy.

### Re-deploy

`deploy-qorechain.mjs` refuses when `frontend/deployed-addresses.json`
already holds real QoreChain addresses. Re-run with `--force` to redeploy
(the old addresses are then abandoned).

## 5. Frontend (Vercel)

The frontend is a static site (`frontend/`, no build step).

**Known blocker:** the Muse Vercel connection gets **403 — not authorized
for scope `tonibanzais-projects`** on `create_git_project`, and there are no
stored Vercel credentials on this VM (`~/.vercel` does not exist). Do not
fight the 403 — import the repo in the Vercel dashboard instead:

1. Vercel dashboard → Add New → Project → import `agusher21/banzai-vegas-qorechain`.
2. Root Directory: `frontend`. Framework: Other / static. No build command, no output directory change.
3. Deploy.

Until the contracts are deployed, the frontend shows "NOT DEPLOYED YET". Once
`deployed-addresses.json` holds the real addresses (written by the deploy
script, committed + pushed), the frontend reads the chain live.

## 6. Fest "Create project" form

The form does NOT save drafts — fill every field in one session. All fields
are prepared in `FEST_FIELDS.md`. The video (≤3 min) and the Vercel import
are still Toni's steps.
