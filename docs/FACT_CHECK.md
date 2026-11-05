# Fact check

Every vendor fact the code depends on: source, date checked, and what is still open.

## Arkiv (checked 2026-11-05)

| Fact | Value | Source |
|---|---|---|
| Network | Rabdi (DB-Chain testnet), chain ID **7794095**, native token tGLM | Arkiv MCP `network_status` (live `eth_chainId` probe); SDK source `src/chains/rabdi.ts` |
| SDK | `@arkiv-network/sdk@1.0.1` + `viem` (installed, npm integrity verified by MCP) | MCP `network_status`, `node_modules/@arkiv-network/sdk/package.json` |
| RPC | `https://rpc.rabdi.db-chain.testnet.arkiv.network/<accessKey>`; SDK builds it via `rabdi({ accessKey })`; `""` = public, heavily rate-limited | SDK `src/chains/rabdi.ts` |
| Access key / faucet | https://hub.arkiv.network/access-keys, https://hub.arkiv.network/faucet | MCP `network_status` |
| Explorer | https://rabdi.explorer.arkiv.network (tx: `/tx/{hash}`), data explorer `/entity-explorer` | MCP `network_status` (configuration snapshot, not probed) |
| Schema API | `defineSchema(name, columns)`; columns `str/i32/u64/u256/dec/bool/addr/key/bytes`; `.indexed()` (not on `bytes`); `.optional()` | SDK `src/schema/*` |
| Limits | `str` ≤ 128 UTF-8 bytes; all `bytes` values in one create share 128 KiB; query `MAX_LIMIT` = 100 | MCP `guides/quickstart`; SDK `src/query/engine.ts` |
| Expiry | `ExpirationTime.fromDays(n)`; fromDays(30) = 1,296,000 blocks (2 s blocks); max lifetime 7,884,000 blocks; no unlimited expiry | SDK `src/entity/expiry.test.ts`; MCP `network_status` |
| Write safety | gas ≥ max(1,000,000, 2×estimate), ≤ block gasLimit/2; fresh nonce/gasPrice; no automatic resend; verify receipt | MCP `guides/quickstart` |
| Read rows | attribute values come back as `{ type, value }`; `bytes` value is hex | SDK `src/query/selection.ts` (`toRow`) |

**Live evidence:** read-only query of `semmal_agent_profile_v1` on Rabdi succeeded (0 entities, no access key) on 2026-11-05. **No write has been made yet.**

**Signing (decision 2026-11-06):** wallet mode only, as the Arkiv guide prefers. No private key exists in SEMMAL. The browser wallet signs and broadcasts; reads go through the API's allowlisted read-only proxy (`eth_*` reads plus `arkiv_query`, `arkiv_getEntity`, `arkiv_getBlockTiming`, the only Arkiv methods in SDK 1.0.1 source). Wallet network params come from SDK `src/chains/rabdi.ts`.

**Design decisions:** anyone can write any schema name, so the API only shows entities whose `$creator` is the owner, an admin or a trusted publisher from `data/admin.json` (managed in `/admin`), and parses every entity body with the v1 Zod contract. Only public profile data goes on Arkiv; availability and live state stay off-chain.

**Open:** exact entity URL path on the explorer (only the data-explorer root is used); expiry/renewal scheduler not built yet.

## 0G Compute Router (checked 2026-11-05)

Source pages: https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/{overview,quickstart,authentication,models,features/chat-completions,errors,privacy,routing,features/image-inputs,features/verifiable-execution}

| Fact | Value |
|---|---|
| Base URL | mainnet `https://router-api.0g.ai/v1`; testnet `https://router-api-testnet.integratenetwork.work/v1` (separate balances and keys) |
| Auth | `Authorization: Bearer sk-…`; keys from pc.0g.ai → Dashboard → API Keys; `sk-` keys cannot read `/v1/account/*` (needs `mk-` with `account:read`) |
| Inference | `POST /v1/chat/completions`, OpenAI-compatible |
| Trust mode | header `X-0G-Provider-Trust-Mode: standard \| verified \| private`; `private` = TeeML providers only; no provider → `503 no_provider_for_trust_mode` (no silent fallback); bad value → `400 invalid_trust_mode` |
| Request ID | `x_0g_trace.request_id` in the body; also `x_0g_trace.provider`, `x_0g_trace.billing.{input_cost,output_cost,total_cost}` (neuron, 1e18 neuron = 1 0G); errors carry top-level `request_id` |
| Verification | body `verify_tee: true` → `x_0g_trace.tee_verified` (true / false / absent); header `ZG-Res-Key` = chat ID for independent verification |
| Models | `GET /v1/models` (no auth); images if `architecture.input_modalities` contains `image`; private-capable if `verifiability == "TeeML"` |
| Env var names | not documented; ours are application names |

**Observed live (2026-11-05):** `/v1/models` responses differ by gateway instance (header `X-0g-Gateway-Instance`): one returned 124 models with `verifiability` (e.g. `0gm-1.0-35b-a3b`: TeeML, text+image); another returned 79 models with **no** `verifiability` field and no `0gm-*` model. The adapter therefore reports "unconfirmed" instead of OK when the catalog can't confirm, and relies on the documented per-request 503 for enforcement.

**Not documented:** a response field that echoes the trust tier actually used. The UI shows "requested, enforced by Router" unless `tee_verified` is true.

**Open:** which vision model to use for private mode (candidate `0gm-1.0-35b-a3b`, availability varies); real request ID not yet captured (no API key configured).

## Taste / design

Palette, type and hero were dealt with the taste-skill scripts (`start.mjs deal/css`, `assets/layout/deal.mjs`): graphite + safety orange, Sora / Figtree / Martian Mono, soft radius.

## 3D robot models (added 2026-11-06)

Seven robot types are rendered from real geometry in `apps/web/public/models/*.glb`, adapted from
MuJoCo Menagerie (https://github.com/google-deepmind/mujoco_menagerie): loaded in MuJoCo 3.17, posed
at their home keyframe, visual geoms only, merged by colour, simplified, meshopt-compressed (~800 KB
total). Licences are copied to `public/models/LICENSES/` and listed on `/credits`:
skydio_x2, shadow_hand, google_robot, pal_tiago (Apache-2.0); unitree_go2, unitree_g1, universal_robots_ur5e (BSD-3-Clause style).
The rover is TIAGo's mobile base only. Types are shown by category; the app does not claim to support those vendors' products.

## Task pricing (added 2026-11-06)

Owners do not set task prices. They set a `pricing` policy on the robot's Arkiv profile (min fee, max
quote, margin %, spend cap per task). `packages/quote` prices each task deterministically (no model output):
specialists at their live Arkiv listing price (hired by the 6.3 rule), 0G inference at the live Router
`/v1/models` `pricing.prompt`/`pricing.completion` (neuron per token, 1e18 neuron = 1 0G) x estimated tokens
per call, converted at `ZEROG_USDC_RATE` (configured by the operator; quotes needing inference are declined
while it is unset), plus an operating-time estimate per robot type (engineering estimates in
`OPERATING_MICRO_PER_MIN`, labelled "estimate" on every quote). Live check 2026-11-06: model
`0gm-1.0-35b-a3b` priced from the catalog; 1 call x ~500 tokens = 0.000556 USDC at a test rate of 1.
**Open:** a trusted 0G/USDC price source; token estimates per call are assumptions until measured from real calls.
