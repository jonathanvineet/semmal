# SEMMAL — Claude Code Project Instructions

> Build a simulation-first autonomous Robot-as-a-Service marketplace and robot-agent economy using ROS 2, Gazebo, 0G Private Computer, Arkiv, and 0G Storage.
>
> **Preserve the core concept:** The marketplace discovers and assigns a capable robot to a customer task. Every robot is itself an autonomous master agent with its own identity and budget. After receiving a task, the robot master agent decides which specialist agents it needs, discovers and hires them, coordinates their work, and remains accountable for the result. Specialist agents have their own identities, capabilities, pricing, and service logic; a specialist may itself delegate to another specialist. Do not invert this hierarchy by having the marketplace centrally assign specialists to the robot.

## 0. Instructions to Claude Code

1. Inspect the existing repository, git status, OS, installed tools, and project conventions before modifying anything. Preserve existing working code.
2. Work incrementally. Start with Phase 0; do not attempt the entire system in one pass.
3. Verify every vendor SDK/API against current official documentation and the installed package version. Never invent method names, endpoints, headers, model IDs, chain IDs, RPC URLs, or environment variables.
4. Maintain `docs/FACT_CHECK.md` with verified facts, source URLs, date checked, assumptions, unresolved organiser/vendor questions, limitations, and test evidence.
5. Put external integrations behind adapters. The simulator must run without external credentials.
6. **No mock data in the product.** The UI shows only real records (Arkiv entities, real 0G responses) and plain empty states when there are none; it never uses the word "simulated". A teaching panel that is not live data is labelled `Example`. Never present mock request IDs, signatures, payments, transaction hashes, or Storage roots as real. Test doubles stay in tests. The robot runtime may still be Gazebo during development; that is an engineering detail, not product copy.
7. Never expose private keys or API keys to an LLM or frontend. Never let model output directly command motor PWM, arbitrary ROS topics, shell commands, or unrestricted wallet signing.
8. Emergency stop and safety interlocks must work without internet, 0G, Arkiv, or Storage.
9. Do not claim a feature works without a test or live integration proving it.
10. At the end of each phase, report changed files, commands run, tests, failures, and next steps.
11. **No private keys on the platform.** No wallet key, mnemonic or signer key in this repo, in platform env files, in the browser, in logs or in AI context. People sign their own actions in their own wallet (EIP-1193) after an in-app approval. The only key in the system is each **robot's own device key**: generated on the robot PC or imported there by its owner during first-run setup, stored outside the repo (`~/.semmal/robots/<name>/robot-key`, mode 600), never transmitted; it signs only SEMMAL robot identity messages (a fresh registration challenge over the robot's reported facts), allowlisted evidence writes (Arkiv episode/incident/quote/claim entities, 0G Storage uploads) under a daily fee cap, so evidence is written automatically and no person can alter or withhold it, and native 0G payments on Galileo to allowlisted recipients only (an agent's owner wallet from its Arkiv listing for a job, its own owner for the margin, the paying customer for a refund), never more per task than the customer paid (or the owner's per-task cap on an owner test task), under per-payment and daily caps, exactly once per payment. Service API keys with no wallet alternative (0G Router `sk-`) stay server-side only.

## 1. Product architecture and boundaries

| Component | Responsibility | Must not do |
|---|---|---|
| Marketplace backend | Booking, robot matching, customer auth, live state, dashboard APIs | Choose the robot's specialist agents |
| Robot master agent | Mission plan, specialist discovery/hiring, budget, coordination, outcome | Override safety interlocks |
| Specialist agents | Narrow contracted capabilities; optional bounded delegation | Access unrestricted robot funds or motors |
| ROS 2/local controller | Sensor integration, navigation, actuator control | Depend on remote AI for immediate safety |
| Safety supervisor | Deterministic fault response, stop/latch/recovery state | Wait for AI diagnosis |
| 0G Private Computer | Private/verifiable inference at mission checkpoints | Host the persistent master-agent runtime or motor loop |
| Arkiv | Queryable registry, episode/incident indexes, milestones, reputation checkpoints | Store raw private camera footage or high-frequency telemetry |
| 0G Storage | Episode/incident bundles and replay evidence | Be assumed permanently available without verification |

### Robot master-agent responsibilities

- Receive a task assigned by the marketplace.
- Validate task, robot capabilities, safety state, availability, and budget.
- Discover specialists from the agent registry.
- Filter by capability, robot compatibility, availability, price, reputation, and deadline.
- Choose and hire specialists itself, using bounded jobs and budgets.
- Validate specialist outputs and service receipts.
- Make high-level decisions, invoking 0G PC when semantic inference is needed.
- Request constrained, validated ROS 2 actions.
- Record decisions, inference request IDs, costs, incidents, and outcomes.
- Report progress and final results.

The robot remains accountable for the task even when it delegates work.

### Initial specialist agents

Implement two or three genuine services first: Vision, Inspection/Task, and Maintenance. Navigation Planning or Delivery Verification can follow. A specialist may delegate to another specialist only within declared capability, deadline, and budget limits. Use versioned request/response schemas; treat every specialist response as untrusted input.

## 2. Platform fact-check requirements

### 2.1 0G Private Computer / Compute Router

Official starting points (re-check current content before implementation):
- https://docs.0g.ai/developer-hub/building-on-0g/compute-network/overview
- https://docs.0g.ai/developer-hub/building-on-0g/compute-network/inference-provider
- https://pc.0g.ai/

The Compute Router is documented as an OpenAI-compatible endpoint with a unified balance and API key. This does **not** automatically provide separate native balances for every specialist agent.

Implementation rules:
- Verify current endpoint, auth, request format, model IDs, trust-mode configuration, response fields, errors, and request-ID behaviour from current docs.
- Keep our own correlation ID separate from the actual provider-returned request ID.
- Capture provider request ID, model, requested/confirmed trust mode, latency, and available billing metadata.
- Confirm the selected model supports the required trust/privacy mode. For sensitive inputs, fail closed if private mode is unavailable; never silently downgrade.
- Do not assume Direct Compute SDK response verification applies to Router responses. Use only the documented verification flow for the chosen integration.
- Do not claim zero data retention without stating the exact mode, scope, metadata retained, and current documentation.
- The application must not retain prompt bodies, raw images, or audio by default.
- Send event-triggered observations/keyframes, not every camera frame or motor tick.
- Measure actual latency and cost for the selected model and trust mode. Remote inference is not suitable for high-frequency control.

Use a provider adapter similar to:

```ts
interface InferenceRequest {
  correlationId: string;
  taskId: string;
  robotId: string;
  agentId: string;
  purpose: "vision" | "planning" | "maintenance" | "speech";
  model: string;
  trustRequirement: "private" | "verified" | "standard";
  payload: unknown;
  deadlineMs?: number;
}
interface InferenceResult {
  correlationId: string;
  providerRequestId?: string;
  model: string;
  requestedTrustMode: string;
  confirmedTrustMode?: string;
  output: unknown;
  latencyMs: number;
  providerMetadata?: Record<string, unknown>;
}
```

### 2.2 Separate identities and billing

Keep these concepts distinct:

1. Robot identity wallet (Arkiv ownership and optional payments).
2. Specialist agent identity wallet.
3. 0G Router API key/billing account.
4. Privy/iAI user account and daily credits.

Router unified balance is not per-agent accounting. For the MVP, one disclosed Router billing account plus an internal per-agent metering ledger is acceptable. Label it application accounting, not native 0G subaccounts. Verify whether independent Router accounts/keys with separate balances are supported before claiming independent agent compute economics.

A robot's payment to a specialist for a service is separate from the specialist's inference bill. Use spending caps, allowlisted recipients, per-task budgets, and idempotency keys. Customer and owner payments are signed by their own wallet after in-app approval; the platform holds no signer (rule 0.11).

**Payment model (implemented):** everything is priced and paid in native 0G on Galileo. The customer pays the robot's signed quote from their own wallet to the robot wallet (memo `semmal:quote:<quoteId>`); the robot checks it on chain. Before each agent job the robot pays the agent owner's wallet (memo `semmal:job:<jobId>`); the runner checks that transfer on chain before calling 0G, and one transfer pays one job. After the episode the robot sends what it did not spend to its owner (completed) or back to the customer (not completed). Each agent calls 0G with its own Router `sk-` key, created with the management key and capped per day (`credit_limit`, `reset_period: daily`, `allowed_models`, `trust_mode`); all keys still draw on one Router deposit, so this is a per-agent spend cap and usage record, not a separate wallet. No escrow contract: the customer trusts the robot between payment and completion. Confirm with hackathon organisers whether the required Privy/iAI flow accepts a robot/service-owned account; a robot wallet does not automatically satisfy that requirement.

### 2.3 Arkiv

Official starting points:
- https://arkiv.network/
- https://hub.arkiv.network/

Use Arkiv for robot registry, specialist-agent registry, episode index, incident index, selected delivery/task milestones, reputation checkpoints, and references to Storage roots/inference request IDs.

Keep live pose, GPS, battery, heartbeat, availability, and frequent telemetry in PostgreSQL/Redis or equivalent. Never put secrets, API keys, raw private imagery, customer personal data, or sensitive exact live location into public/queryable entities.

Verify current SDK method names, network configuration, field types, query/index rules, ownership, expiry, and event semantics. Do not assume expiry emits an event; use an off-chain scheduler/indexer for expiry and checkpoints. A hash/Merkle root does not reconstruct expired source records. Retain encrypted evidence separately if audit requirements require it.

Describe Arkiv records as verifiable/tamper-evident within the documented chain model, not proof that a sensor observation was truthful or that compromised hardware cannot lie.

### 2.4 0G Storage

Official starting point:
- https://docs.0g.ai/developer-hub/building-on-0g/storage/sdk

Verify current SDK upload/download/proof APIs, endpoints, provider availability, and retention. Store episode/incident bundles containing canonical manifests, selected diagnostics, ROS state transitions, agent receipts, inference request IDs, model/trust metadata, software versions, checksums, and robot signature.

Default policy: no raw video/private camera images. Minimise and redact evidence; encrypt sensitive bundles client-side; keep decryption keys out of Arkiv. Store the returned Storage root in Arkiv only after successful upload. Verify downloads using the current documented proof path. Do not claim permanent availability without evidence and a replication/retry policy.

### 2.5 Hackathon requirement mapping

Map implementation to the supplied 0G PC and Physical AI track brief:
- Real 0G PC inference in the main user-visible workflow.
- Real provider request ID visible.
- Model and privacy/trust mode accurately identified.
- A meaningful product capability depends on 0G.
- If required, Privy sign-in and eligible iAI credit consumption.
- Physical robot simulation or hardware.
- Actual 0G inference inside the robot decision loop.
- Episode data in 0G Storage and index/reference in Arkiv.
- Replayable simulation.
- Safe stop when 0G is unreachable.
- No fabricated fallback decision.

**Confirm with organisers:** whether one project can be judged in both tracks; whether simulation qualifies for each award; whether robot/service wallet qualifies for iAI bonus; exact rubric and demo requirements. Do not claim eligibility until verified.

## 3. Target architecture

```text
Customer Web App
  -> Marketplace API
      -> PostgreSQL/Redis: bookings, live state, GPS, telemetry
      -> Arkiv adapter: registries, episodes, incidents, reputation
      -> 0G Storage adapter: episode/incident bundles
      -> wallet/payment service: optional bounded escrow
      -> WebSocket: live dashboard updates
  -> Robot gateway (MQTT/HTTPS/ROS bridge)
      -> Robot Master Agent
          -> Specialist Agent Registry and specialist APIs
          -> 0G PC inference adapter
          -> ROS 2 mission interface
              -> Nav2 / mission executor
              -> perception and sensor nodes
              -> diagnostics and safety supervisor
              -> Gazebo simulation OR physical robot
```

0G PC is the inference provider, not the persistent agent runtime. The master agent is a separately implemented process on the robot edge computer or a trusted host in simulation.

Suggested repository layout (adapt to existing repo):

```text
semmal/
  CLAUDE.md
  README.md
  .env.example
  docs/{FACT_CHECK,ARCHITECTURE,THREAT_MODEL,API_CONTRACTS,DEMO_SCRIPT}.md
  apps/{web,api}/
  services/
    robot-master/
    agent-registry/
    specialist-agents/{vision,inspection,maintenance}/
    event-processor/
    reputation/
  packages/
    contracts/
    agent-sdk/
    wallet-guard/
    zerog-pc-adapter/
    arkiv-adapter/
    zerog-storage-adapter/
    telemetry/
  ros2_ws/src/
    semmal_description/
    semmal_gazebo/
    semmal_bringup/
    semmal_interfaces/
    semmal_base/
    semmal_safety/
    semmal_diagnostics/
    semmal_navigation/
    semmal_sim_faults/
  simulation/{scenarios,fixtures,replay}/
  tests/{integration,e2e,fault-injection}/
  scripts/
```

## 4. Physical robot and ROS 2 plan

### 4.1 Simulation-first platform

Use an indoor differential-drive mobile robot in a small warehouse. Begin with a TurtleBot-like base or a simple custom base; do not start with a complex manipulator.

Simulated components:
- Left/right drive wheels and encoders.
- Odometry and TF.
- IMU.
- 2D lidar or depth sensor.
- RGB camera.
- Battery state.
- Simulated motor current and temperature diagnostics.
- Emergency-stop state.
- Optional bumper/contact sensor.

### 4.2 ROS 2 and Gazebo versions

Inspect host OS first. Select a currently supported ROS 2 distribution and compatible Gazebo release. Prefer a supported Ubuntu LTS setup (Ubuntu 24.04 if compatible with the selected ROS release and project constraints); otherwise document a VM/container. Use matching modern ROS-Gazebo integration (`ros_gz` where appropriate). Do not assume Gazebo Classic commands/plugins work with modern Gazebo. Record exact tested versions and installation commands in `docs/FACT_CHECK.md`.

### 4.3 ROS graph

Implement these logical nodes. Document actual topic/action names, units, QoS, timeouts, and message schemas:

| Node | Role | Example interface |
|---|---|---|
| `robot_state_node` | Battery, pose, health | `/robot/state`, `/battery_state` |
| `camera_node` | Camera feed | `/camera/image_raw` |
| `lidar_node` | Range scan | `/scan` |
| `imu_node` | IMU | `/imu/data` |
| `wheel_controller` | Differential drive | `/cmd_vel` or controller interface |
| `odometry_node` | Odometry and TF | `/odom`, TF |
| `diagnostics_node` | Current/temp/encoder/watchdog | `/diagnostics`, `/fault_events` |
| `safety_supervisor` | Safe state and emergency stop | `/safety/state`, `/emergency_stop` |
| `mission_executor` | Validated mission goals | Nav2/custom action |
| `fault_injector` | Simulation-only faults | `/sim/fault_inject` |
| `robot_gateway` | Events to master/backend | Authenticated bridge |

Use topics for streams, services for request/response, and actions for long-running missions. Validate units, ranges, QoS, timeouts, and ownership.

### 4.4 Safety boundary

- Motor control and emergency stop work with internet disconnected.
- Safety state machine: `NORMAL`, `DEGRADED`, `STOPPING`, `E_STOP`, `RECOVERY_REQUIRED`.
- Safety supervisor cancels navigation and commands stop on critical fault.
- Master agent can request only bounded, validated ROS actions.
- Safety supervisor can reject/cancel any command.
- Validate speed, acceleration, obstacle clearance, geofence, and operation mode.
- Stale safety sensor or controller heartbeat loss causes safe state.
- No AI response can clear a safety latch or alter hard thresholds.

## 5. Gazebo simulation

Create a deterministic warehouse world with floor, walls, shelves/aisles, static obstacles, an inspection target, robot spawn pose, and destination zone. Keep it small and repeatable.

Use URDF/Xacro or SDF appropriate to selected Gazebo version. Include wheel joints, collision/inertial properties, differential-drive system/plugin, sensor frames/plugins, mass and wheel geometry, `robot_state_publisher`, TF, and `ros_gz` bridges as appropriate.

Validate in order: spawn -> TF -> odometry -> lidar/camera -> wheel control -> navigation. Use Nav2 if compatible. Start with a known map; SLAM is optional later. The core demo is semantic decision plus safe execution, not novel SLAM.

## 6. Master agent and specialist protocol

### 6.1 Task state machine

```text
IDLE -> TASK_RECEIVED -> VALIDATING -> PLANNING
 -> DISCOVERING_SPECIALISTS -> HIRING_SPECIALISTS
 -> EXECUTING -> VERIFYING -> COMPLETED | FAILED | ABORTED
                 \-> PAUSED | DEGRADED | INCIDENT
```

Persist transitions with timestamp, reason, actor, and correlation ID. On restart, recover safely and never repeat a payment or mission command blindly.

### 6.2 Agent contracts

Use versioned JSON Schema/Zod contracts. Example logical fields:

```ts
type AgentListing = {
  agentId: string;
  ownerWallet: string;
  endpoint: string;
  capabilities: Array<{
    capabilityId: string;
    inputSchemaVersion: string;
    outputSchemaVersion: string;
    supportedRobotTypes: string[];
    supportedTaskTypes: string[];
  }>;
  price: { amount: string; token: string; unit: string };
  availability: "available" | "busy" | "offline";
  serviceVersion: string;
};

type AgentJob = {
  jobId: string;
  parentTaskId: string;
  requestingRobotId: string;
  requestingAgentId: string;
  targetAgentId: string;
  capabilityId: string;
  input: unknown;
  budgetLimit: string;
  deadline: string;
  idempotencyKey: string;
};

type AgentResult = {
  jobId: string;
  agentId: string;
  status: "succeeded" | "failed" | "rejected";
  output?: unknown;
  serviceReceipt?: string;
  cost?: { amount: string; token: string };
  childJobs?: string[];
  evidenceRefs?: string[];
};
```

Never accept arbitrary executable code. Validate identity/signature where implemented, schema, deadline, budget, and safety policy.

### 6.3 Discovery and hiring

The robot master agent:
1. Queries the agent registry for required capability.
2. Filters robot/task compatibility.
3. Checks live availability.
4. Ranks by capability, price, reliability, latency, and reputation.
5. Gets quote/terms if needed.
6. Checks budget and policy.
7. Authorises bounded job/payment.
8. Validates result and receipt.
9. Decides whether to use the result.
10. Permits specialist delegation only within declared budget/policy.

Separate customer task budget, robot specialist-hiring budget, specialist service payments, 0G Router inference bill, and internal agent-level inference attribution. Do not call internal attribution a native 0G subaccount.

## 7. 0G decision loop

Main demo:
1. Robot navigates locally to an inspection waypoint.
2. Camera captures a frame or privacy-minimised crop.
3. Vision specialist submits it to a selected supported 0G PC model using required trust mode.
4. Parse response into a strict application schema, e.g.:

```json
{
  "observation": "machine_panel",
  "anomaly_detected": true,
  "anomaly_type": "possible_obstruction",
  "confidence": 0.87,
  "recommended_action": "pause_and_request_inspection"
}
```

This is an application schema, not the provider's native response format.

5. Master agent validates response and may hire Maintenance/Inspection specialist.
6. Mission executor requests a bounded ROS action.
7. Record actual provider request ID, model, trust mode, latency, decision, and action outcome.

AI output is advisory. Invalid JSON, low confidence, unsupported action, or timeout means reject the proposal. No direct motor command.

If 0G is unavailable for a decision that requires it: do not fabricate a response; do not downgrade sensitive inference; hold position or safe-stop; preserve task state; show `WAITING_FOR_0G`/`SAFE_STOP`; resume only after a real response and safety revalidation or mark aborted. Local safety functions continue.

## 8. Mechanical failure simulation — required

Primary scenario: simulated left drive motor overcurrent/overheating. Optional second scenario: left encoder dropout.

### 8.1 Fault injection

Create a simulation-only `fault_injector` node/service. Example fixture (simulation values only; never use as real hardware thresholds):

```yaml
scenario_id: left_motor_overcurrent
trigger: immediate
fault:
  motor: left
  current_a: 8.5
  temperature_c: 105.0
  encoder_state: normal
duration_ms: 5000
```

Optional encoder fault: hold left encoder ticks stale for a configured duration. Fault injector must be absent/disabled in hardware/production launch. It must never masquerade as real sensor input outside simulation.

### 8.2 Detection and immediate response

Diagnostics detect configured overcurrent/overtemperature thresholds after debounce, stale encoder ticks while commanded motion exists, watchdog timeout, or impossible wheel-response mismatch.

On critical fault:
1. Publish structured fault event.
2. Safety supervisor immediately cancels navigation and commands zero velocity/hardware stop.
3. Enter latched `E_STOP` or `RECOVERY_REQUIRED`.
4. Do not auto-resume when a sensor briefly normalises.
5. Emit local incident even if network/0G is down.

This response must not call AI, Arkiv, or Storage.

### 8.3 Incident manifest

Create canonical signed incident data with at least:

```json
{
  "schema_version": "1.0",
  "incident_id": "uuid",
  "robot_id": "robot-demo-001",
  "task_id": "task-demo-001",
  "episode_id": "episode-demo-001",
  "sequence_number": 42,
  "fault_code": "LEFT_MOTOR_OVERCURRENT",
  "severity": "critical",
  "detected_at": "RFC3339 timestamp",
  "safety_action": "EMERGENCY_STOP",
  "sensor_summary": {
    "left_motor_current_a": 8.5,
    "left_motor_temperature_c": 105.0,
    "left_encoder_stale": false
  },
  "firmware_version": "simulated",
  "inference_request_ids": [],
  "previous_event_hash": null,
  "robot_signature": "signature-from-signing-module"
}
```

Values above are fixtures. Use canonical serialisation and sequence numbers. The manifest hash is signed (EIP-191) by the **robot's own device key** on the robot PC (rule 0.11), automatically, so no person can alter or withhold the record.

### 8.4 Durable offline queue

Persist incident locally before remote writes (SQLite or durable journal). Include unique incident ID, idempotency key, sequence number, bounded exponential retry, and restart recovery.

Track stages separately:
- `LOCAL_DURABLE`
- `STORAGE_CONFIRMED`
- `ARKIV_CONFIRMED`

Never mark remote persistence confirmed without acknowledgement. If Storage succeeds and Arkiv fails, retain the root and retry only the Arkiv index write. On restart, reconcile before retrying. Never create duplicates. Display pending queue count and oldest pending incident.

### 8.5 Storage and Arkiv flow

1. Create sanitised incident bundle: manifest, short diagnostic time series, ROS state transitions, selected logs.
2. Exclude raw video/private customer data by default.
3. Encrypt sensitive bundle client-side.
4. Upload via verified current 0G Storage SDK.
5. Capture returned root; verify via documented download/proof path.
6. Create Arkiv incident index with root, incident/task/episode/robot IDs, fault code, severity, timestamp, sequence, inference IDs, signature/manifest hash.
7. Mark `ARKIV_CONFIRMED` only after confirmed write.
8. Show incident and evidence on operator dashboard.

On network loss, retain local spool and retry automatically. Robot remains safely stopped.

### 8.6 Optional maintenance inference

After stop and local logging, master may ask Maintenance Agent to analyse minimised diagnostics using 0G PC. Diagnosis is advisory only. It cannot clear the safety latch, restart motors, alter thresholds, or override the fault. Recovery requires explicit operator approval or a deterministic approved routine.

### 8.7 Fault-test assertions

Automated tests must prove:
- Fault detected within configured simulation deadline.
- Emergency stop occurs without AI/network.
- Zero wheel command/stop asserted.
- Mission action cancelled/paused.
- Incident locally durable and sequenced.
- Storage root appears only after successful upload.
- Arkiv confirmation appears only after successful write.
- Retries/restarts do not duplicate.
- Dashboard displays incident and persistence state.
- No resume without approved recovery.

Also test network down before fault, network down after Storage but before Arkiv, restart with queued event, duplicate delivery, corrupted bundle/proof failure, and Arkiv RPC outage.

## 9. Episodes, replay, and reputation

Each episode bundle should include IDs, timestamps, simulator/world/model versions, initial pose/goals, selected sensor summaries or ROS bag excerpt, task transitions, specialist jobs/results, 0G request IDs/model/trust/latency, validated action proposals and outcomes, incidents, final outcome, metrics, checksums, and robot signature.

Record deterministic scenario seed. Replay must reproduce the relevant event sequence within simulator tolerances.

Logical Arkiv entities (map to actual SDK-supported fields/types):
- `RobotProfile`: robot ID, owner wallet, hardware, capabilities, ROS interface version, profile version, coarse service area, reputation reference.
- `AgentProfile`: agent ID, owner wallet, capabilities, schema versions, supported robot types, price, service/discovery reference.
- `EpisodeIndex`: episode/task/robot IDs, outcome, timestamps, agents, inference request IDs, Storage root, manifest hash, sequence range.
- `IncidentIndex`: incident/robot/task/episode IDs, fault code, severity, timestamp, safety action, Storage root, manifest hash, sequence, signature.
- `ReputationCheckpoint`: robot ID, period, task count, completion/on-time/safe-stop/recovery metrics, incident counts, score version, source-confidence breakdown, episode commitment.

Do not assume arbitrary arrays/nested fields are indexable. Verify Arkiv field constraints and normalise accordingly.

Reputation must expose transparent dimensions. Do not punish a robot for a correct safe stop. Distinguish hardware fault, environment, specialist error, operator error, and customer cancellation. Publish any composite score formula/version. A hash does not recover expired source data.

## 10. Backend and dashboard

Backend: customer/operator auth, task booking, robot discovery, live availability check, task assignment, heartbeat/state, event ingestion, live GPS forwarding, agent discovery, optional escrow, provider adapters, and audit queries.

Dashboard:
- Customer: task request/status, assigned robot, coarse live progress, milestones, completion.
- Operator: robot health/battery, task, specialist choices, current 0G decision, real request ID/model/trust/latency, incident/safe-stop state, Storage root, Arkiv confirmation, pending queue, recovery controls.
- Demo: persistent `SIMULATION` label; real vs mock integration indicators.

Live GPS/telemetry belongs in PostgreSQL/Redis and WebSocket. Arkiv gets selected milestones, not every GPS point. GPS alone is not proof of delivery; use appropriate confirmation (OTP/QR/geofence and evidence policy).

## 11. Security and privacy

- Secrets only in environment/secrets manager. Commit `.env.example`, never `.env`.
- Separate customer auth, robot wallet, agent wallet, and Router credentials.
- No private keys on the platform (rule 0.11): people sign in their own browser wallet; the only key is each robot's device key, which never leaves the robot PC and signs only allowlisted evidence writes and capped 0G payments to allowlisted recipients.
- No Router or Arkiv access keys in browser or LLM context.
- Least-privilege keys where supported; separate dev/test/demo credentials.
- Authenticated robot gateway and replay protection.
- Validate every agent response and apply deadlines/budgets/rate limits/recipient allowlists.
- Use idempotency for payment, task, upload, and chain write.
- Do not log raw prompts, private images/audio, API keys, wallet keys, or personal data.
- Sensitive inference fails closed if required trust mode is unavailable.
- Local safety works offline.
- Blockchain records prove recorded data according to chain rules, not physical sensor truth.

Create `docs/THREAT_MODEL.md` for malicious specialists, compromised robot, replayed messages, key theft, malicious customer task, prompt injection in camera text/signage, inference outage, Storage/Arkiv outage, and unsafe recovery.

## 12. Environment template

Create `.env.example` with placeholders only. Do not guess endpoints or chain IDs.

```dotenv
NODE_ENV=development
APP_MODE=simulation
API_PORT=3001
WEB_PORT=3000
DATABASE_URL=postgresql://user:password@localhost:5432/semmal
REDIS_URL=redis://localhost:6379

ZEROG_ROUTER_BASE_URL=
ZEROG_ROUTER_API_KEY=
ZEROG_DEFAULT_MODEL=
ZEROG_REQUIRED_TRUST_MODE=private
ZEROG_REQUEST_TIMEOUT_MS=30000

# Arkiv Rabdi (chain 7794095): the SDK builds the RPC URL from the access key.
ARKIV_ACCESS_KEY=
# Trusted publishers and admins are managed in /admin (wallet sign-in), not here.

ZEROG_STORAGE_RPC_URL=
ZEROG_STORAGE_INDEXER_URL=

PAYMENT_CHAIN_RPC_URL=
ROBOT_WALLET_ADDRESS=
PAYMENT_TOKEN_ADDRESS=
MAX_TASK_BUDGET=
MAX_AGENT_JOB_BUDGET=

PRIVY_APP_ID=
PRIVY_APP_SECRET=
IAI_INTEGRATION_ENABLED=false

ROBOT_ID=robot-demo-001
ROS_DOMAIN_ID=42
ROS_NAMESPACE=/semmal
SIM_WORLD=warehouse
SIM_FAULT_INJECTION_ENABLED=true
```

Validate configuration at startup and never print secret values. Fill network variables only from current official docs/console. Record verified network, chain ID, RPC, faucet, and token details in `docs/FACT_CHECK.md`.

## 13. Implementation phases and acceptance criteria

### Phase 0 — Audit and fact check
Inspect repository, OS, git status, package managers, existing ROS/Gazebo. Verify current official 0G, Arkiv, Storage, ROS/Gazebo, and hackathon docs. Write fact-check and architecture docs.
**Accept:** version matrix, sources, assumptions, open questions; no invented SDK snippets.

### Phase 1 — Simulation foundation
Launch warehouse world, spawn robot, verify TF/odometry/lidar/camera/wheel control, navigate to waypoint.
**Accept:** repeatable launch from clean setup.

### Phase 2 — Safety and mechanical fault
Implement diagnostics, safety supervisor, deterministic motor fault, local durable incident spool.
**Accept:** automated test proves stop and local incident without network/AI.

### Phase 3 — Master agent and specialists
Task state machine, ROS mission action, registry, Vision and Maintenance agents. Robot chooses and hires.
**Accept:** task assigned to robot; robot master selects specialist; validated result affects mission.

### Phase 4 — Real 0G PC
Use current API/model/trust docs; make real inference at checkpoint; capture request ID; validate schema; timeout/fail-closed tests.
**Accept:** real request ID visible; real result affects high-level decision; no fake fallback.

### Phase 5 — 0G Storage
Sanitised episode and incident bundle, upload, root capture, verified retrieval.
**Accept:** retrieve and verify bundle using real root.

### Phase 6 — Arkiv
Register robot/agent; write/query episode and incident indexes referencing Storage roots; expiry/checkpoint handling.
**Accept:** real queryable records; no raw imagery/high-frequency telemetry.

### Phase 7 — Offline recovery
Network outage, durable queue, restart, retry, idempotent Storage then Arkiv write.
**Accept:** no duplicate incident; confirmed/pending stages accurate.

### Phase 8 — Marketplace/dashboard
Customer task, robot discovery from Arkiv, live availability from operational DB, assignment, tracking, operator incident view.
**Accept:** full UI-to-simulation flow.

### Phase 9 — Wallet economy/iAI (scope permitting)
Scoped signing, budget controls, service payment if verified; investigate separate Router billing identities; Privy/iAI only after eligibility confirmation.
**Accept:** no key exposure; tests pass; real vs simulated accounting clearly separated.

### Phase 10 — Demo hardening
Clean-start instructions, automated tests, deterministic seed, credential preflight, under-three-minute demo. Never fake an AI decision.

## 14. Test matrix

| Scenario | Expected result |
|---|---|
| Spawn robot | Robot, TF, and sensors available |
| Navigate waypoint | Local action succeeds |
| Semantic inspection | Real 0G call; request ID captured |
| Unsupported private mode | Sensitive request fails closed |
| 0G timeout | No fabricated result; safe wait/stop |
| Invalid model output | Schema/policy rejects it |
| Specialist unavailable | Master selects compatible alternative or reports inability |
| Over-budget specialist | Rejected before payment |
| Malicious output | Unsafe action blocked |
| Motor overcurrent | Immediate local stop |
| Encoder dropout | Diagnostic fault latched |
| Offline incident | Local spool persists |
| Restart with queued event | Recovery without duplicate |
| Storage succeeds, Arkiv fails | Root retained; Arkiv retried only |
| Storage proof fails | Evidence marked invalid |
| Arkiv query | Registry/incident returned |
| Reputation update | Safe stop not treated as misconduct |
| Replay | Scenario reproduces within simulator tolerances |

## 15. Three-minute demo

- **0:00–0:20:** Customer requests warehouse inspection. Marketplace discovers robot from Arkiv and assigns it.
- **0:20–0:50:** Robot master agent discovers and chooses Vision/Inspection specialist. Show that the robot makes this choice.
- **0:50–1:20:** Robot reaches waypoint; real 0G PC inference occurs. Show actual request ID, model, trust mode, latency. Master chooses next high-level action; ROS safety validates it.
- **1:20–2:10:** Inject simulated left motor fault. Robot stops immediately. Show local incident, Storage bundle/root, Arkiv index. Optionally disconnect network first and show pending queue then retry.
- **2:10–2:40:** Show incident/reputation history, Arkiv record, and Storage retrieval/proof.
- **2:40–3:00:** Explain: removing 0G removes private/verifiable semantic inference used for the inspection decision and its request-level evidence. Local safety still works by design.

Never describe Gazebo as physical hardware.

## 16. Honest limitations to disclose

- Simulation is not proof of real-world reliability.
- 0G PC is event-driven inference, not motor control or persistent agent hosting.
- Router balance is unified unless current docs prove separate per-agent accounts; internal metering is not native subaccount billing.
- Robot wallet, agent wallet, Router billing identity, and Privy/iAI user are distinct.
- Privacy depends on model, trust mode, provider availability, and current product guarantees; application retention must also be controlled.
- Arkiv records do not prove sensor truth.
- Storage roots/proofs establish content integrity against a root, not guaranteed permanent availability.
- If required 0G inference is unavailable, safe-stop; do not fake a decision.
- Unimplemented payment/iAI flows must be labelled prototype/mock.

## 17. Final completion checklist

- [ ] Robot master-agent hierarchy preserved; robot chooses specialists.
- [ ] At least two specialist capabilities work end-to-end.
- [ ] Gazebo warehouse and robot launch reproducibly.
- [ ] ROS 2 control and local safety work offline.
- [ ] Mechanical fault is injected and detected deterministically.
- [ ] Emergency stop occurs without 0G/network.
- [ ] Incident is durable locally and retries after connectivity returns.
- [ ] Real 0G PC inference is in the main decision loop.
- [ ] Real provider request ID is captured and shown.
- [ ] Selected model supports requested trust mode.
- [ ] 0G Storage episode and incident uploads are verified.
- [ ] Arkiv robot/agent/episode/incident records are queryable.
- [ ] Arkiv records reference Storage roots.
- [ ] Dashboard distinguishes live, pending, and confirmed state.
- [ ] Replay reproduces the key scenario.
- [ ] No secret/key reaches LLM or browser.
- [ ] No private key exists anywhere; every chain write is wallet-signed after in-app approval.
- [ ] No fake inference, signature, root, transaction, or payment is presented as real.
- [ ] README and `docs/FACT_CHECK.md` contain sources, versions, assumptions, and limitations.

**Begin with Phase 0. Do not skip ahead.**
