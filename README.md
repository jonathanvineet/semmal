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
- **Publishing agents** happens only in the owner's dashboard (`/admin`, after wallet sign-in): each listing is signed by your own wallet; no private key is stored or entered anywhere. Fund the wallet at https://hub.arkiv.network/faucet.
- `/admin` (web): sign in with your wallet (a free signed message, not a transaction). On first start the API terminal prints a one-time setup code; enter it to make your wallet the owner. The owner manages admins and trusted Arkiv publishers there. Roles are stored in `data/admin.json`.
