# SEMMAL build plan

> Rules live in `CLAUDE.md`; verified vendor facts in `docs/FACT_CHECK.md`. This plan says who builds
> what, in what order, and how the robot PC and the platform meet.

## Status (2026-11-06)

| Area | State |
|---|---|
| Web app (3D network, dock, glass UI, workbenches) | Built |
| Arkiv registry: robot + agent profiles, wallet-signed publish/delete, owner-consistency reads | Built |
| Robot registration wizard (7 robot types in 3D, skills, pricing policy, robot wallet) | Built |
| Task quotes from real costs (`packages/quote`) | Built, tested |
| Agent builder on live 0G models; agent runner calling 0G with receipts (`apps/api/src/runner.ts`) | Built, tested; first live 0G call pending an API key |
| Robot gateway (WebSocket, link tokens, live state, tasks) + `services/robot-link` | Built, tested |
| ROS 2 + Gazebo robot, safety, fault, mission | Not started (P2–P4) |
| Robot master agent decision loop | Not started (P5) |
| Automatic evidence: 0G Storage + Arkiv episodes/incidents | Not started (P6) |
| Evidence viewer, replay | Not started (P7) |
| Hackathon write-ups (`/arkiv/*.md`, README, licence) | Not started (P8) |

## Two machines

- **Robot PC**: Ubuntu 24.04, ROS 2 Jazzy, Gazebo Harmonic (versions to verify in `docs/FACT_CHECK.md`
  before P2). Runs the simulation, safety, mission, the robot master agent and the evidence service.
  Holds the robot's own device key (`~/.semmal/robot-key`), nothing else.
- **Platform**: this Mac. Next.js web app, Fastify API (registry reads, quotes, agent runner, gateway).
  Holds no wallet key; the 0G Router API key stays server-side.

## Who does what

| Robot PC (Ubuntu 24.04, ROS 2 Jazzy, Gazebo Harmonic) | Platform (this Mac: Next.js + Fastify) |
|---|---|
| Gazebo warehouse + robot, sensors, wheel control, Nav2 | Marketplace, Arkiv registry reads, quotes (`packages/quote`) |
| Safety supervisor, diagnostics, fault injector, local stop (no network) | **Agent runner = 0G private computing** (`apps/api/src/runner.ts`) |
| Mission executor (bounded ROS actions) | Gateway: link tokens, live state, tasks (`apps/api/src/gateway.ts`) |
| `semmal_gateway` ROS node ⇄ `services/robot-link` | Arkiv expiring coordination: quotes, tasks, job claims |
| **Robot master agent** (`services/robot-master`): plans, hires agents, calls the runner, decides, commands ROS, safe-stops on 0G failure | Evidence viewer: reads Arkiv episodes, downloads + **verifies** 0G Storage bundles server-side |
| **Evidence service**: spool → sign → 0G Storage → Arkiv, automatic with retry | Dashboard: live robot, decisions with 0G request IDs, incidents, replay |

The master agent lives on the robot PC (CLAUDE.md: robot is the agent, not the marketplace).

## The decision loop (main demo)

1. Customer books (wallet-signed Arkiv `TaskRequest`, expires at its deadline) → marketplace picks an
   online robot (gateway availability) → `task_assignment` over the gateway.
2. robot-master validates (safety NORMAL, skill, budget) → computes the quote (`packages/quote`) and
   publishes it as an Arkiv `Quote` offer signed by the robot, expiring in 5 min; customer accepts.
3. robot-master discovers agents on Arkiv and hires (6.3 rule) → posts an Arkiv `JobClaim` (robot-signed,
   expires at the job deadline).
4. Mission executor drives to the waypoint (Nav2) → `semmal_gateway` grabs one camera keyframe
   (`/camera/image_raw`), shrinks it → robot-master sends the job to the runner (robot link-token auth).
5. Runner calls 0G in **private** mode → checked JSON + receipt with **0G request ID**.
6. robot-master validates the action (allowlist, confidence floor) → bounded ROS action (pause / continue
   / return). If 0G times out or fails: `WAITING_FOR_0G` → hold → `SAFE_STOP` after the deadline; never
   a made-up answer.
7. Injected left-motor fault → supervisor E-stops locally (no AI, no network) → incident spooled.
8. Evidence service: signed episode + incident bundles → 0G Storage (root) → Arkiv `EpisodeIndex` /
   `IncidentIndex` (root, manifest hash, request IDs), stages LOCAL_DURABLE → STORAGE_CONFIRMED →
   ARKIV_CONFIRMED, automatic retry, no duplicates.
9. Dashboard shows the decisions, request IDs, stop, Storage root (verified download) and Arkiv records;
   `replay.sh <episode>` reproduces it from the seed + rosbag excerpt.

## Phases

### P0. Docs and rules (first, small)
- Rewrite `PLAN.md` to this split and phase list; mark built pieces done (gateway, runner, quotes).
- `CLAUDE.md` rule 0.11 → "No private keys on the platform, in the repo, in env files on the platform,
  in the browser or in AI context. The only key is each **robot's own device key**, generated on the
  robot PC, stored outside the repo (`~/.semmal/robot-key`, mode 600, optional passphrase), never
  transmitted. It signs only allowlisted evidence writes under a daily fee cap. People sign their own
  actions in their own wallet." Same change in §2.2, §8.3, §11.
- `docs/FACT_CHECK.md`: 0G Storage facts just verified: `@0gfoundation/0g-storage-ts-sdk` + ethers;
  `Indexer.upload(file, rpc, signer)` → `{rootHash, txHash}`; `download(root, path, true)` = proof check;
  Galileo testnet chain **16602**, RPC `https://evmrpc-testnet.0g.ai`, turbo indexer
  `https://indexer-storage-testnet-turbo.0g.ai`, faucet `https://faucet.0g.ai` (0.1 0G/day). zerobot
  reviewed: Go2-over-WebRTC + Galileo contracts, no ROS/Gazebo; not adopted (note in reach.md).

### P1. Platform: robots can call the runner, Arkiv coordination state
- Runner auth: accept a robot's link token (`Authorization: Bearer slk_…`, `LinkStore.verify` in
  `apps/api/src/gateway.ts`) in addition to the owner session on `POST /api/agents/:id/jobs`; job
  `requestingRobotId` must equal the token's robot. Rate limit per robot.
- New Arkiv schemas in `packages/arkiv-adapter/src/schemas.ts` (encoders in `encode.ts`, reads in
  `registry.ts`, same owner-consistency rule):
  - `semmal_task_request_v1` (customer wallet, expires at deadline; indexed: skill, area, status),
  - `semmal_quote_v1` (robot wallet, expires 5 min; indexed: task_id, robot_id, amount),
  - `semmal_job_claim_v1` (robot wallet, expires at job deadline; indexed: agent_id, task_id),
  - `semmal_episode_v1`, `semmal_incident_v1` (robot wallet; Storage root, manifest hash, request IDs,
    sequence; long-lived).
- Customer booking UI (`/book`): pick robot from `/quote`, wallet-signed `TaskRequest`, live status.
- Gateway: forward accepted bookings as `task_assignment`; record quotes/claims the robot reports.

### P2. Robot PC: simulation foundation (`ros2_ws/src`, PLAN A.1)
`semmal_description` (xacro diff-drive, lidar, RGB camera, IMU, bumper), `semmal_gazebo` (warehouse
world + inspection panel, ros_gz bridge), `semmal_bringup` (launch), `semmal_navigation` (Nav2 +
static map + named waypoints). `scripts/robot/setup_ubuntu.sh`, `check_env.sh`. Verify in order:
spawn → TF → odom → scan/camera → cmd_vel → Nav2 to waypoint (launch_testing).

### P3. Robot PC: safety, fault, local spool (PLAN A.2)
`semmal_interfaces`, `semmal_base` (motor current/temp), `semmal_diagnostics`, `semmal_safety`
(supervisor owns final `/cmd_vel`, latch, recovery only via approval), `semmal_sim_faults`
(left-motor overcurrent, encoder dropout; refuses to start outside sim), `semmal_incident` (canonical
manifest, seq, previous-event hash, SQLite spool first). Test with network unplugged.

### P4. Robot PC: mission + gateway node
`semmal_mission` (`ExecuteMission` action, named waypoints only, limits), `semmal_gateway` rclpy node:
writes `SEMMAL_STATE_FILE` (safety, battery, zone, executor ready) that `services/robot-link` already
relays; exposes a localhost-only API to robot-master (`start_mission`, `pause`, `capture_keyframe`,
`state`). No topic passthrough.

### P5. Robot PC: robot master agent (`services/robot-master`, Node/TS)
Task state machine (CLAUDE.md 6.1) persisted in SQLite; receives tasks via robot-link; quote via
`packages/quote`; discovery/hiring via platform API (reuse `pickSpecialists` in `packages/quote`);
keyframe → runner job; validates output with `VisionInspectionOutput` (`packages/contracts`) + action
allowlist + confidence floor; commands ROS via the gateway node API; WAITING_FOR_0G → SAFE_STOP on
timeout; reports `mission_progress`. Fold robot-link into it (one robot-host process).

### P6. Robot PC: automatic evidence (`services/robot-master/evidence`)
- `semmal-robot keygen` → device key + address; that address is the robot wallet registered on Arkiv
  (robot id already derives from it). Owner funds it with tGLM (Arkiv) and 0G (Galileo) from faucets.
- Signer: viem local account from the device key, wrapped by an **allowlist guard**: only Arkiv creates
  of SEMMAL episode/incident/quote/claim schemas and the 0G Storage flow contract; daily fee cap;
  journal; no resend after uncertain submission (reuse `guardedWalletClient` in
  `packages/arkiv-adapter/src/guarded-writer.ts` with a device signer instead of `walletSigner`).
- Bundle: manifest (CLAUDE.md 8.3) + decisions (each with 0G request ID, model, trust, latency) +
  state transitions + diagnostics excerpt; canonical JSON; EIP-191 robot signature; no raw images.
- Upload with `@0gfoundation/0g-storage-ts-sdk` (`MemData`), record root, then Arkiv index; stages and
  retry as CLAUDE.md 8.4; Storage-ok/Arkiv-fail retries Arkiv only.

### P7. Platform: evidence viewer and replay
Dashboard robot page: episodes and incidents from Arkiv (owner = robot wallet, robot = registered),
decisions with request IDs, persistence stages; server route downloads the bundle by root with proof
(`indexer.download(root, path, true)`), checks manifest hash and robot signature, shows "verified".
Replay: rosbag excerpt + seed in the bundle; `scripts/robot/replay.sh <episode>` on the robot PC.

### P8. Submission
`/arkiv/schema.md`, `friction.md`, `reach.md`, `why-arkiv.md`, `how-you-use-arkiv.md` (with runnable
queries); README: writer wallets (owner, robot), one query, setup for both machines; `LICENSE`
(Apache-2.0); AI-usage note; `docs/DEMO_SCRIPT.md` (<3 min). Ask organisers: both tracks allowed?
"contract addresses" when none are deployed? exact deadline?

## Order and parallelism
P0 → (P1 on the Mac) in parallel with (P2 → P3 → P4 on the Ubuntu PC) → P5 → P6 → P7 → P8.
P8 write-ups can start any time.

## Critical files
- Docs: `PLAN.md`, `CLAUDE.md`, `docs/FACT_CHECK.md`, new `/arkiv/*.md`, `README.md`, `LICENSE`
- Platform: `apps/api/src/{app.ts,gateway.ts,runner.ts}`, `packages/arkiv-adapter/src/{schemas,encode,registry,guarded-writer}.ts`,
  `packages/contracts/src/index.ts`, `apps/web/src/components/{AdminDashboard,RobotLink}.tsx`, new `apps/web/src/app/book`
- Robot: `ros2_ws/src/semmal_*` (new), `services/robot-link` → `services/robot-master` (new), `scripts/robot/*`

## Verification
- Platform: `pnpm test` (API: runner robot-auth, Arkiv encoders, gateway task flow), `next build`.
- Robot PC: `colcon build && colcon test` (launch_testing: bringup, safety stop with network down,
  fault latch, no auto-resume), robot-master unit tests (state machine, WAITING_FOR_0G → SAFE_STOP,
  invalid model output rejected, idempotent job/evidence retries).
- End to end (both machines): book → quote offer on Arkiv → robot drives → real 0G request ID in the
  dashboard → injected fault stops the robot → bundle on 0G Storage (verified download) → Arkiv episode
  and incident queryable → `replay.sh` reproduces the run; repeat with the network cut before 0G
  (safe stop, nothing invented) and between Storage and Arkiv (Arkiv retried only).
