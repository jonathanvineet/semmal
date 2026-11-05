# semmal

Robot-as-a-service marketplace where every robot hires its own specialist agents. Simulation-first. See `CLAUDE.md` (rules) and `PLAN.md` (tracks and integration).

## Run (platform side)

```bash
pnpm install
cp .env.example .env        # fill only what you have; everything else stays labelled SIMULATED
pnpm dev:api                # http://127.0.0.1:3001
pnpm dev:web                # http://localhost:3000 (proxies /api to the API)
```

- `pnpm test`: API tests (Arkiv outage → SIMULATED labels, operator auth, 0G fails closed).
- `pnpm zerog:preflight`: checks the configured 0G models; with a key, makes one real private-mode call and prints the provider request ID.
- `/publish` (web): publish the demo robot and agents to Arkiv Rabdi with your own browser wallet (MetaMask etc.). No private key is stored or entered anywhere; the API is read-only and its Arkiv RPC proxy refuses every send/sign method. Fund the wallet at https://hub.arkiv.network/faucet, then add its public address to `ARKIV_TRUSTED_PUBLISHERS`.
