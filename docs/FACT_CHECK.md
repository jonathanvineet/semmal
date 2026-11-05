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

## Agent runner (added 2026-11-06)

`apps/api/src/runner.ts`, route `POST /api/agents/:agentId/jobs` (the web app also serves the listed
endpoint `/agents/:agentId/jobs` by rewrite). Loads the listing from Arkiv (owner-consistent), checks
capability, budget >= listed price, deadline and the per-kind input schema before any 0G call; calls
the listing's model with `X-0G-Provider-Trust-Mode` = the listing's trust mode and `verify_tee`;
accepts only output matching the per-kind schema (`AGENT_OUTPUTS`); `tee_verified: false` is a
failed job. Image input uses the OpenAI `image_url` content part as on the 0G image-inputs page.
Idempotent by `idempotencyKey` (SQLite `data/agent-jobs.db`). Receipt = provider request ID, chat
ID, provider, model, trust evidence, latency, input/output sha256 and a receipt hash; **unsigned**
(no keys in SEMMAL). Jobs are owner-session only until the robot gateway authenticates robots.
Payments are not executed (charge is reported only). Inspection delegation to vision is not run yet.
**Not yet live-tested:** needs `ZEROG_ROUTER_API_KEY` (empty on this machine).

## ROS 2 / Gazebo (checked 2026-11-06, on this host)

Facts taken from the installed packages, not from memory: plugin parameter names from the gz-sim 8 plugin binaries,
`gz_frame_id` from gz-sensors 8, bridge config format from `ros_gz_bridge`, launch args from `ros_gz_sim/launch/gz_sim.launch.py`.

| Item | Value |
|---|---|
| OS | Ubuntu 24.04.5 LTS, x86_64, NVIDIA RTX 2050 (ogre2 sensor rendering works headless) |
| ROS 2 | Jazzy (`/opt/ros/jazzy`) |
| Gazebo | Harmonic, `gz sim` 8.15.0 (vendored `gz_sim_vendor`), sdformat 14 |
| ros_gz | `ros-jazzy-ros-gz{,-sim,-bridge}` 1.0.24 |
| robot_state_publisher / xacro | 3.3.4 / 2.1.1 |
| Nav2 | **not installed** (`ros-jazzy-navigation2` 1.3.13 is available in apt; installing needs sudo) |
| Systems used | `gz-sim-diff-drive-system`, `gz-sim-joint-state-publisher-system`, `-physics-`, `-user-commands-`, `-scene-broadcaster-`, `-sensors-system` (ogre2), `-imu-system` |
| Install | `scripts/robot/setup_ubuntu.sh` (idempotent, sudo); check with `scripts/robot/check_env.sh` |

**Simulation tuning found by measurement.** Comparing odometry against Gazebo ground truth (`gz model -m semmal -p`):
- A four-point contact (2 wheels + 2 casters) and cylinder wheel collisions under-reported yaw by ~10% when turning in
  place. The cylinder's edge contacts gave an effective track of ~0.32 m instead of 0.36 m, and missions ended ~0.9 m off target.
- With one rear caster, the CoM 4 cm behind the axle and sphere wheel collisions, odometry matched ground truth
  to < 1 mm after a 4 s turn and a 0.8 m drive. After a 25 m mission the true pose was (7.907, 1.500, yaw 0.0003)
  against the target (8.0, 1.5, 0).
- Gazebo's DiffDrive has no command timeout. It keeps the last `/cmd_vel`, so the supervisor publishes continuously
  and the launch shuts everything down if the supervisor exits.
- rclpy raises `ValueError: Logger severity cannot be changed between calls` when one call site logs at different
  severities. This crashed the supervisor once during testing and is now fixed in both nodes.

**Test evidence (2026-11-06, headless):**
- `python3 -m pytest tests/robot`: 34 passed (safety state machine, diagnostics rules, spool idempotency and stage
  rules, route graph, layout clearance, generated-file freshness, scenario validation, motor model).
- Mission `dock → inspection_point_A`: COMPLETED in ~60 s. The keyframe shows the machine panel centred.
- `tests/robot/sim_fault_check.py` (live, no network or AI in the path):
  - `left_motor_overcurrent`: 15/15. Detection 227–256 ms, E_STOP 228–257 ms (deadline 0.5/0.6 s).
  - `left_encoder_dropout`: 15/15. Detection 522 ms, E_STOP 523 ms (configured 0.5 s window, deadline 0.8/0.9 s).
  - Both: `/cmd_vel` exactly zero, mission ABORTED_SAFETY, incident LOCAL_DURABLE with sequence number, no motion
    after the sensor normalises, recovery rejected while active and without approval, accepted with approval.

**Open:** Nav2/AMCL (needs sudo install); `launch_testing` version of the fault check for CI; robot gateway and
master agent (Phase 3); outbox to Storage/Arkiv (Phases 5–7).


## House world and Gazebo Fuel (checked 2026-11-06)

| Item | Value / evidence |
|---|---|
| Fuel API | `https://fuel.gazebosim.org/1.0/models?q=<term>` (search), model URI `https://fuel.gazebosim.org/1.0/<Owner>/models/<Name>/<version>`. Reachable from this host. |
| Download/cache | `gz fuel download -u <uri>` into `~/.gz/fuel/fuel.gazebosim.org/openrobotics/models/<name>/<version>`. 26 models ≈ 81 MB. |
| Licence | All 26 OpenRobotics models: Creative Commons Attribution 4.0 International (`license_name` in the Fuel API response). Attribution in `docs/MODEL_CREDITS.md`. |
| Offline | With `https_proxy` pointed at a dead port (network unreachable for the process), `measure_models.py` loaded all 26 versioned URIs from the cache and produced an identical catalog. |
| Footprints | gz-sim 8 Python bindings: `gz.sim8.Link.compute_axis_aligned_box(ecm)` returns the AABB **in the link frame** (first version wrongly treated it as world frame; fixed by transforming the 8 corners with `Link.world_pose`). `import gz.math7` is required first or pybind11 cannot convert the return type. |
| Rejected models | Washer v3 (collision mesh measures 0.03 m), Shower v2 (wall-mounted head only). Both confirmed visually. |
| Rendering cameras | gz-sensors renders a camera only when its topic has a subscriber. `<save enabled>` alone produced no frames, so `render_views.py` subscribes over gz-transport (`gz.transport13`, `gz.msgs10`). |
| Front directions | Read from top-down renders, then corrected by rendering every model `facing: south` toward a camera. Sofa, oven and Refrigerator were 180° or 90° off in the first reading. |

**Test evidence (house, headless, single Gazebo server):**
- `pytest tests/robot`: 44 passed. Layout checks run for both worlds, and the furniture-overlap check was mutation-tested (toilet pushed into a wall and sofa onto the coffee table were both caught).
- `/clock` 1 kHz (real time), `/scan` 9.9 Hz, `/camera/image_raw` 9.8 Hz, `/odom` 49.6 Hz.
- Mission `dock → inspection_point_A` (two doorways): COMPLETED in 38–39 s. Gazebo true pose (−10.00, 4.91) vs target (−10.0, 5.0). The keyframe shows the electrical box centred.
- Tour `bathroom, office, bedroom, guest_room, living_room, kitchen, dock` (~85 m, every doorway): COMPLETED in 312 s, zero safety faults. Final true pose 9 cm from the dock target.
- `sim_fault_check.py` in the house: overcurrent 15/15 (E_STOP 239 ms), encoder dropout 15/15 (detection 789 ms, deadline 0.8 s).
- Warehouse regression after the launch refactor: inspection mission COMPLETED in 63 s, true pose (7.907, 1.500), unchanged.

**Incidents found while testing (fixed):**
- A Wi-Fi/IP change cut gz-transport/DDS multicast mid-run ("Network is unreachable"). Odom and scan stopped and the
  supervisor latched E_STOP on heartbeat loss, which is correct behaviour. `scripts/robot/env.sh` now forces
  `ROS_AUTOMATIC_DISCOVERY_RANGE=LOCALHOST` (Jazzy) and `GZ_IP=127.0.0.1`. The user's shell profile sets `SUBNET`,
  so a `${VAR:-default}` default was not enough.
- `stop_sim.sh` only matched `warehouse.sdf`, so house servers survived and two Gazebo servers ran at once with
  shared topic names (a warehouse mission failed with "no progress"). The pattern now matches any world, and
  `run_sim.sh` refuses to start while a SEMMAL simulation is running. A house fault-check run made while the
  orphan was alive was discarded and repeated on a clean system (numbers above).
## Robot gateway (added 2026-11-06)

WebSocket `GET /api/gateway` on the API (`@fastify/websocket` 11, `ws` 8). The robot authenticates
with a link token (`Authorization: Bearer slk_...`) its owner creates in the dashboard; only a
sha256 is stored (`data/robot-links.json`), compared in constant time, revocable. Messages are the
`RobotToPlatform` schemas (hello, heartbeat, mission_progress, incident_notice, task_ack), max 16 KiB,
strictly increasing `seq` (replays rejected), hello within 5 s, offline after 15 s without a
heartbeat, one session per robot. Public status (`/api/robots/live`) is online/availability only;
owners see battery, safety state, zone and an event log. Tasks are refused unless the robot reports
NORMAL. Live state is in memory (PostgreSQL/Redis later). `services/robot-link` is the robot-host
side: it relays state written by the ROS 2 gateway node (`SEMMAL_STATE_FILE`) and reports DEGRADED,
declining tasks, when that state is missing; battery falls back to the host's own reading.
Tests: `apps/api/src/gateway.test.ts` against a real WebSocket server.
