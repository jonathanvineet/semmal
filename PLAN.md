# SEMMAL — Build Plan

> Companion to `CLAUDE.md`. That file is the source of truth for rules and acceptance criteria.
> This plan splits the work into **two independent tracks** that can be built in parallel,
> then describes exactly **how they meet**.
>
> - **Track A — Robot side (Ubuntu + ROS 2 + Gazebo):** simulation, sensors, control, safety, fault injection, mission execution, the robot gateway, the robot master agent, and the offline incident spool.
> - **Track B — Platform side (UI + backend):** marketplace API, database, dashboard, agent registry, specialist agents, and the 0G PC / Arkiv / 0G Storage adapters.
> - **Integration:** shared contracts, one narrow authenticated gateway link, and a staged sequence of integration milestones.
>
> Status: **DRAFT — Phase 0 not yet done.** Anything marked `VERIFY` must be confirmed against current official docs and recorded in `docs/FACT_CHECK.md` before code depends on it.

---

## 0. Guiding decisions

| Decision                   | Choice                                                                                                                                                                                                          | Why                                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Split line                 | Everything that must work **offline** (motion, safety, fault detection, local incident spool) lives on the robot host. Everything that is **multi-tenant / customer-facing** lives on the platform. | Safety must not depend on network (CLAUDE.md §4.4, §8.2).                                                                       |
| Master agent location      | Runs on the **robot host** (Ubuntu box), as its own process next to ROS 2 — not in the backend.                                                                                                          | The robot is the autonomous agent. Putting it in the backend would let the marketplace act as the agent and invert the hierarchy. |
| Specialist agents location | Independent HTTP services. They usually run on the platform machine, but they are separate processes with their own identity and pricing.                                                                       | They are separate economic actors, not modules inside the backend.                                                                |
| Robot ↔ platform link     | A **custom robot gateway** (ROS 2 node) that opens an **outbound** authenticated WebSocket to the backend and only allows listed message types.                                                     | Like a real robot behind NAT. **Do not use raw `rosbridge`**: it exposes arbitrary topics, which CLAUDE.md §0.7 forbids. |
| Master agent ↔ ROS        | The master agent talks to ROS **only through the gateway's local mission API** (an allowlist of validated actions).                                                                                       | It can't reach `/cmd_vel` or other arbitrary topics.                                                                            |
| Contract source of truth   | JSON Schema in `packages/contracts/schemas/`, versioned. TS gets Zod/ajv validators and Python gets `jsonschema` validators from the same files.                                                            | One schema, two languages, no drift.                                                                                              |
| Language split             | ROS nodes in **Python (rclpy)**, with C++ only if timing needs it. Master agent, specialists, backend and adapters in **TypeScript (Node)**.                                                        | The Arkiv / 0G Storage / 0G Router SDKs are JS/TS-first (`VERIFY`), and the shared agent-sdk is one codebase.                   |
| Develop without each other | Track B ships a **SIMULATED robot emulator** that speaks the gateway protocol from fixtures. Track A ships a **CLI gateway client** that pretends to be the backend.                                | Each track can be fully tested before the other is ready.                                                                         |

---

## 1. Hardware and host layout

```text
┌──────────────────────────── Mac (arm64, macOS 26) ────────────────────────────┐
│  Track B                                                                       │
│  apps/web (dashboard)        apps/api (marketplace)      PostgreSQL / Redis    │
│  services/agent-registry     services/specialist-agents/{vision,maintenance,…} │
│  packages/{zerog-pc-adapter, arkiv-adapter, zerog-storage-adapter, contracts}  │
└───────────────▲──────────────────────────────────────────▲─────────────────────┘
                │ WSS (robot gateway, outbound from robot)  │ HTTPS (agent jobs)
┌───────────────┴──────────────── Ubuntu host ─────────────┴─────────────────────┐
│  Track A                                                                        │
│  Gazebo world + robot model     ROS 2 graph (safety, diagnostics, Nav2, …)      │
│  semmal_gateway (ROS node)  ⇄  services/robot-master (Node process)             │
│  incident spool (SQLite)        no keys: chain writes signed in owner's wallet  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Ubuntu host options (choose in Phase 0)

| Option                                                                 | Pros                                                                        | Cons                                                                                                                     |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **A. Separate x86_64 Ubuntu 24.04 machine/laptop (recommended)** | Most packages available, GPU rendering for camera sensors, fewest surprises | Needs a second machine on the same LAN                                                                                   |
| B. UTM / Parallels arm64 Ubuntu VM on the Mac                          | One machine                                                                 | arm64 ROS/Gazebo binaries and VM GPU rendering need checking (`VERIFY`); camera sensor rendering may be slow or broken |
| C. Remote cloud Ubuntu box                                             | Powerful, reproducible                                                      | Network latency for the GUI; needs a VPN/tunnel to the Mac backend                                                       |
| D. Docker on the Mac                                                   | Reproducible                                                                | Gazebo GUI and GPU in Docker on macOS are painful; fine for headless CI later                                            |

Start on A or B. Add a Docker/headless setup later for CI and replay tests.

---

## 2. Track A — Robot side (Ubuntu + ROS 2 + Gazebo)

### A.0 Environment (Phase 0)

- Pick a supported ROS 2 distro and its **officially paired** Gazebo release. Current candidate: **ROS 2 Jazzy + Gazebo Harmonic on Ubuntu 24.04** (`VERIFY` the support window and pairing on docs.ros.org and gazebosim.org; consider newer distros only if their pairing is stable).
- Use `ros_gz` (`ros_gz_sim`, `ros_gz_bridge`) and `gz_ros2_control` or the Gazebo DiffDrive system (`VERIFY` which one is current for the chosen release). **No Gazebo Classic plugins.**
- Record the exact apt packages, versions and install commands in `docs/FACT_CHECK.md`.
- Write `scripts/robot/setup_ubuntu.sh` (idempotent) and `scripts/robot/check_env.sh` (prints versions and fails clearly).

### A.1 Simulation foundation (Phase 1)

Packages under `ros2_ws/src/`:

| Package                | Contents                                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `semmal_description` | Xacro/URDF: diff-drive base, wheel joints, inertials/collisions, lidar, RGB camera, IMU, bumper; frames `base_link`, `odom`, `base_scan`, `camera_link`, `imu_link`              |
| `semmal_gazebo`      | `warehouse.sdf` world (walls, shelf aisles, static obstacles, inspection target "machine panel", spawn pose, destination zone), ros_gz bridge YAML                                       |
| `semmal_bringup`     | `sim.launch.py` (world + spawn + bridges + robot_state_publisher), `nav.launch.py`, `full.launch.py`; a `use_fault_injector` argument that defaults to **false** outside sim |
| `semmal_navigation`  | Nav2 params, a **pre-built static map** of the warehouse, named waypoints (`inspection_point_A`, `dock`, `destination`)                                                        |

Check in order: **spawn → TF tree → `/odom` → `/scan` + `/camera/image_raw` → `/cmd_vel` moves wheels → Nav2 reaches a waypoint.**
Accept: `ros2 launch semmal_bringup full.launch.py` from a clean workspace reaches `inspection_point_A`, and a scripted check (`tests/robot/test_bringup.py`, launch_testing) passes.

### A.2 Safety, diagnostics and fault injection (Phase 2)

| Package                | Node                  | Role                                                                                                                                                                                                                                                                                      |
| ---------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `semmal_interfaces`  | —                    | Custom msgs/srvs/actions: `SafetyState.msg`, `FaultEvent.msg`, `MotorDiagnostics.msg`, `InjectFault.srv`, `RequestRecovery.srv`, `ExecuteMission.action`                                                                                                                      |
| `semmal_base`        | `motor_sim_node`    | Publishes simulated left/right motor current (A) and temperature (°C) from wheel effort + fault overlay. `SIMULATED` in the message header frame / status field                                                                                                                        |
| `semmal_diagnostics` | `diagnostics_node`  | Overcurrent/overtemp with debounce, stale encoder while motion is commanded, watchdog, wheel-response mismatch → `/fault_events`, `/diagnostics`                                                                                                                                     |
| `semmal_safety`      | `safety_supervisor` | State machine `NORMAL/DEGRADED/STOPPING/E_STOP/RECOVERY_REQUIRED`. **The only node allowed to publish to the final `/cmd_vel`**: it muxes the Nav2 output and forces zero on fault. Cancels Nav2 goals. Latches. Clears only through `RequestRecovery` with operator approval |
| `semmal_sim_faults`  | `fault_injector`    | `/sim/fault_inject` service, YAML scenarios (`left_motor_overcurrent`, `left_encoder_dropout`). Launch refuses to start it unless `APP_MODE=simulation`                                                                                                                           |
| `semmal_incident`    | `incident_recorder` | Builds the canonical incident manifest, assigns a sequence number and previous-event hash, marks it `SIMULATED_SIGNATURE` until the owner's wallet signs the manifest hash, writes it **to the SQLite spool before anything else**                                                                                |

Velocity chain: `Nav2 → /cmd_vel_nav → safety_supervisor (limits + interlock) → /cmd_vel → Gazebo`.

Accept (automated, network unplugged):

- Fault is detected within the configured deadline.
- `/cmd_vel` drops to zero, the Nav2 goal is cancelled, and the state latches to `E_STOP`.
- The incident is in SQLite with its sequence number.
- The sensor going back to normal does **not** resume motion.
- Recovery without approval is rejected.

### A.3 Mission interface and gateway (Phase 3, robot half)

- `semmal_mission/mission_executor`: action server `ExecuteMission`. Accepts only **named waypoints from the map allowlist** plus bounded parameters (max speed, dwell, `capture_keyframe`). Validates against geofence, safety state and operation mode, then forwards to Nav2.
- `semmal_gateway/robot_gateway` (rclpy):
  - **Upstream (to backend):** outbound WSS, robot-authenticated with a signed challenge (`VERIFY` the scheme in the threat model), replay protection (nonce + sequence). Sends heartbeat, coarse pose, battery, safety state, mission progress and incident notices.
  - **Local (to master agent):** a localhost-only HTTP/WebSocket mission API with a small fixed command set: `start_mission(waypoints)`, `pause`, `resume_request`, `capture_keyframe`, `get_state`. No topic passthrough.
  - Keyframes stay on the robot host; only the master agent or a hired Vision specialist receives a minimised crop, per job.
- `services/robot-master` (Node, runs on the Ubuntu host): task state machine (§6.1), persisted in its own SQLite DB; specialist discovery and hiring; budget ledger; decision records. Talks to ROS only through the gateway's local API.

### A.4 Robot-side remote persistence (Phases 5–7, robot half)

- An `outbox` worker (in `robot-master`, or a small separate process) reads the SQLite spool → builds the sanitised and encrypted bundle → 0G Storage upload → verifies → Arkiv index write.
- Stages per record: `LOCAL_DURABLE → STORAGE_CONFIRMED → ARKIV_CONFIRMED`, an idempotency key, bounded exponential backoff, and reconcile-on-restart.
- **No private keys** (CLAUDE.md rule 0.11). The robot host queues the bundle and its manifest hash; Storage upload and Arkiv index writes are signed by the owner's wallet in the operator dashboard, and the robot only records the confirmed root and entity key. The local `LOCAL_DURABLE` stage and the safety stop never depend on a wallet.

### A.5 Replay (Phase 10)

- Deterministic scenario seed; ROS bag excerpt of the key topics; `scripts/robot/replay.sh <episode_id>` reproduces the event sequence; a test compares event order and timing within tolerance.

---

## 3. Track B — Platform side (UI + backend)

### B.0 Workspace (Phase 0)

- pnpm monorepo (`VERIFY` the versions installed on the Mac): `apps/web`, `apps/api`, `services/*`, `packages/*`.
- Node LTS, TypeScript strict, Vitest, ESLint/Prettier.
- `docker-compose.yml` for PostgreSQL + Redis only (fine on the Mac).
- `.env.example` exactly as in CLAUDE.md §12. Config validation runs at startup and never prints secrets.

### B.1 Contracts and SDK (start immediately, shared with Track A)

`packages/contracts/schemas/v1/`:

| Schema                                                                                                                                                       | Used by                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| `gateway.hello`, `gateway.heartbeat`, `gateway.robot_state`, `gateway.mission_progress`, `gateway.incident_notice`, `gateway.persistence_status` | Robot → backend                  |
| `gateway.task_assignment`, `gateway.recovery_approval`, `gateway.ack`                                                                                  | Backend → robot                  |
| `task.request`, `task.assignment`                                                                                                                        | Customer → marketplace → robot  |
| `agent.listing`, `agent.job`, `agent.result`, `agent.quote`                                                                                          | Master ↔ registry ↔ specialists |
| `inference.request`, `inference.result` (CLAUDE.md §2.1 shape)                                                                                          | Adapters                          |
| `vision.inspection_output` (the `observation / anomaly_detected / … / recommended_action` app schema)                                                   | Vision specialist → master       |
| `incident.manifest`, `episode.manifest`                                                                                                                  | Robot → Storage/Arkiv            |

`packages/agent-sdk`: job signing/verification helpers, schema validation, deadline/budget checks, idempotency keys. Used by both robot-master and the specialists.

### B.2 Backend — `apps/api` (Phases 3 and 8)

- Fastify or NestJS (choose in Phase 0) + PostgreSQL (Prisma/Drizzle) + Redis pub/sub + WebSocket.
- Modules:
  - `auth`: customer and operator roles (Privy only after Phase 9 eligibility is confirmed).
  - `tasks`: booking and lifecycle.
  - `robots`: discovery (Arkiv registry via adapter; local cache in Phase 3), live availability from Redis, assignment.
  - `gateway`: the WSS endpoint robots connect to; auth, replay protection, fan-out to the dashboard.
  - `incidents`: mirror of robot-reported incidents and their persistence stages, read-only.
  - `audit`: query Arkiv records and Storage roots.
  - `recovery`: operator approval → signed `recovery_approval` to the robot, which the robot still validates locally.
- The backend **never** selects specialists. It only shows the choices the robot reports.

### B.3 Agent registry and specialists (Phase 3)

- `services/agent-registry`: Phase 3 uses a local store behind an `AgentRegistry` interface. Phase 6 adds the Arkiv implementation of the same interface. `AgentProfile` records follow CLAUDE.md §9.
- `services/specialist-agents/vision`: takes an `agent.job` with a keyframe crop → calls `zerog-pc-adapter` → validates the output against `vision.inspection_output` → returns an `agent.result` with a receipt and the provider request ID.
- `services/specialist-agents/maintenance`: takes minimised diagnostics → advisory diagnosis through 0G PC. It **cannot** clear latches.
- `services/specialist-agents/inspection` (optional): may delegate to Vision within budget. This demonstrates nested delegation.
- At least two Vision listings with different price/reputation, so the master's ranking choice is visible in the demo.

### B.4 Adapters (Phases 4–6)

Each adapter has an interface, a `Simulated*` implementation (labelled `SIMULATED` everywhere), and a `Real*` implementation built **only after the docs are verified**:

| Package                    | Real implementation needs (all `VERIFY`)                                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `zerog-pc-adapter`       | Router base URL, auth header, model IDs, trust-mode selection and confirmation fields, request-ID field, errors, billing metadata. Fail closed on trust mismatch |
| `zerog-storage-adapter`  | TS SDK package/version, upload → root, download + proof verification, endpoints/indexer, retention                                                              |
| `arkiv-adapter`          | SDK package, network/chain ID/RPC, entity create/query/annotations, field types, expiry semantics                                                                |
| `wallet-guard` (Phase 9) | Spending caps, recipient allowlist, idempotency; owner's wallet signs (no key in the system)                                                                                                 |

### B.5 Dashboard — `apps/web` (Phase 8)

Next.js (`VERIFY` version) with a WebSocket client. A persistent **`SIMULATION`** banner, plus **REAL / SIMULATED** badges on every integration value.

- **Customer view:** request inspection, assigned robot, coarse progress, milestones, completion.
- **Operator view:** robot health/battery/safety state; mission timeline (task state machine); **specialists the robot chose and why** (candidates, ranking, price); current 0G decision (request ID, model, requested vs confirmed trust, latency); incident panel with `LOCAL_DURABLE / STORAGE_CONFIRMED / ARKIV_CONFIRMED`, pending queue count, oldest pending; Storage root + verify button; Arkiv record link; recovery approval control.
- **Demo controls (simulation only):** "inject left motor fault", "drop network", "restore network". These are routed to the robot gateway, which refuses them outside sim.

### B.6 Robot emulator — `simulation/emulator` (Track B's stand-in for Track A)

A Node process that connects to `apps/api` exactly like a real gateway, plays scripted scenarios (`inspection_happy_path`, `left_motor_overcurrent`, `network_drop_then_retry`) and emits contract-valid messages tagged `SIMULATED_ROBOT`. This lets the whole UI/backend flow be built and tested on the Mac alone.

---

## 4. Integration — how the two halves come together

### 4.1 The only three connection points

```text
1. Robot gateway  ──WSS──►  apps/api /gateway        (state, progress, incidents, assignments, recovery)
2. robot-master   ──HTTPS─► agent-registry + specialists  (discover, quote, hire, results)
3. robot-master / specialists ──► 0G PC, 0G Storage, Arkiv  (through adapters, from whichever host holds that identity's key)
```

Nothing else crosses the boundary. In particular the backend has **no route to ROS topics**, and the dashboard has **no route to the robot** except through the backend's gateway module.

### 4.2 End-to-end flow (main demo)

```text
Customer (web) ─ task.request ─► api
api: discover robots (Arkiv/registry) + availability (Redis) → assign robot-demo-001
api ─ gateway.task_assignment ─► robot_gateway ─► robot-master
robot-master: VALIDATING → PLANNING → DISCOVERING_SPECIALISTS
robot-master ─► agent-registry: capability "vision.inspection" → candidates
robot-master: filter / rank / budget check → HIRING (agent.job, idempotency key)
robot-master ─► gateway local API: start_mission([inspection_point_A])
ROS: Nav2 → safety_supervisor → Gazebo; mission_executor reports progress ─► api ─► dashboard
At waypoint: capture_keyframe → minimised crop → Vision specialist
Vision ─► 0G PC (private mode) → provider request ID + output → agent.result
robot-master: validate schema + confidence + allowed action → decision record
  └─ e.g. "pause_and_request_inspection" → hire Maintenance/Inspection, or continue
Inject fault (sim) → diagnostics → safety_supervisor E_STOP (no network needed)
incident_recorder → SQLite (LOCAL_DURABLE) → outbox → Storage (root) → Arkiv (index)
each stage ─ gateway.persistence_status ─► api ─► dashboard
Operator reviews → approves recovery → robot validates locally → RECOVERY / resume or abort
Episode bundle → Storage → Arkiv EpisodeIndex → reputation checkpoint
```

### 4.3 Integration milestones

Each milestone has an automated check in `tests/integration/`.

| #            | Milestone                | Track A ready                                     | Track B ready                                  | Proof                                                                                                 |
| ------------ | ------------------------ | ------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **I0** | Contracts frozen v1      | —                                                | `packages/contracts` published               | Both languages validate the same fixture set                                                          |
| **I1** | Gateway handshake        | `robot_gateway` connects, sends heartbeat/state | `/gateway` auth + dashboard shows live robot | Robot appears online; killing the gateway shows offline within timeout                                |
| **I2** | Task → motion           | mission_executor + robot-master accept assignment | Task booking + assignment                      | Customer booking drives the Gazebo robot to the waypoint; progress shown                              |
| **I3** | Robot hires a specialist | robot-master discovery/ranking/hiring             | Registry + Vision (SIMULATED inference)        | Dashboard shows the robot's candidate list and choice; result changes the mission                     |
| **I4** | Fault offline            | Phase 2 complete                                  | Incident panel                                 | Network unplugged → E_STOP + local incident; reconnect → backend shows it                           |
| **I5** | Real 0G inference        | Keyframe crop path                                | Real `zerog-pc-adapter`                      | Real provider request ID on dashboard; timeout → `WAITING_FOR_0G` / safe stop, no fake result      |
| **I6** | Real Storage + Arkiv     | Outbox worker                                     | Real adapters + audit view                     | Root retrieved + verified; Arkiv query returns the incident; Storage-ok/Arkiv-fail retries only Arkiv |
| **I7** | Full demo                | Replay + seed                                     | Demo controls + polish                         | Under-three-minute script in `docs/DEMO_SCRIPT.md` runs from a clean start                          |

### 4.4 Network and config wiring

- Robot host `.env`: `ROBOT_ID`, `ROS_DOMAIN_ID`, `API_GATEWAY_URL=wss://<mac-host>:3001/gateway`, `APP_MODE=simulation`. No signer keys on either host.
- Platform `.env`: DB/Redis, Router key (used only by the specialist and adapter processes), Arkiv read config, Privy (later).
- Use the same LAN, or Tailscale/WireGuard for options B/C. Use TLS even in dev (self-signed + pinned) so the auth path stays the same.
- `scripts/preflight.sh` on each host checks reachability, config validity and credential presence (never their values), and shows which adapters are REAL vs SIMULATED.

### 4.5 Order of work

```text
Week-ish 1   Phase 0 on both: fact check, env, repo, contracts I0
             A: sim foundation (A.1)                  B: workspace, api skeleton, emulator (B.0, B.6)
Next         A: safety + fault + spool (A.2)          B: dashboard live view, gateway endpoint → I1
Next         A: mission_executor + gateway + master   B: registry + Vision/Maintenance (sim inference) → I2, I3, I4
Next         Real 0G PC (both sides)                                                                 → I5
Next         Real Storage + Arkiv + offline recovery                                                 → I6
Last         Marketplace polish, replay, demo hardening, (Phase 9 wallet/iAI if confirmed)           → I7
```

---

## 5. Repository layout (target)

```text
semmal/
  CLAUDE.md  PLAN.md  README.md  .env.example  docker-compose.yml
  docs/{FACT_CHECK,ARCHITECTURE,THREAT_MODEL,API_CONTRACTS,DEMO_SCRIPT}.md
  apps/{web,api}/
  services/{robot-master,agent-registry,specialist-agents/{vision,inspection,maintenance},event-processor,reputation}/
  packages/{contracts,agent-sdk,wallet-guard,zerog-pc-adapter,arkiv-adapter,zerog-storage-adapter,telemetry}/
  ros2_ws/src/{semmal_description,semmal_gazebo,semmal_bringup,semmal_interfaces,semmal_base,
               semmal_safety,semmal_diagnostics,semmal_navigation,semmal_sim_faults,
               semmal_mission,semmal_gateway,semmal_incident}/
  simulation/{scenarios,fixtures,replay,emulator}/
  tests/{integration,e2e,fault-injection,robot}/
  scripts/{robot,platform,preflight.sh}
```

One git repo for both tracks. The Ubuntu host clones the same repo and only builds `ros2_ws/` + `services/robot-master` + `packages/*`.

---

## 6. Risks and open items

| Risk / question                                                                        | Mitigation / owner                                                                                                  |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `semmal/` currently has no git repo of its own (the parent repo is rooted at `~`)  | `git init` inside `semmal/` before Phase 0 work                                                                 |
| arm64 VM can't render Gazebo camera sensors reliably                                   | Prefer a separate x86 Ubuntu machine; test camera rendering first in A.1                                            |
| 0G Router private/trust mode unavailable for a vision-capable model                    | Verify in Phase 0; if unavailable, Vision fails closed and the demo shows that honestly. **Do not downgrade** |
| Arkiv field/index limits don't fit the planned entities                                | Normalise fields in the adapter; verify in Phase 0                                                                  |
| 0G Storage SDK is browser- or Node-specific / needs gas tokens                         | Verify the SDK, faucet and token in Phase 0; record in FACT_CHECK                                                   |
| Organiser questions (dual track, simulation eligibility, robot wallet for iAI, rubric) | Ask before Phase 9; don't claim eligibility                                                                         |
| Clock sync between hosts affects incident timestamps and latency                       | chrony/NTP on both; the robot's monotonic sequence numbers are authoritative for ordering                           |

---

## 7. Definition of done

See the CLAUDE.md §17 checklist. In addition, from this plan: **I0–I7 all pass**, both tracks can run on their own (emulator / CLI backend stub), and `scripts/preflight.sh` reports every integration as REAL or SIMULATED accurately.
