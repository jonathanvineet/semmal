# Semmal (செம்மல்): robots that hire, pay and answer for their work

> **செம்மல்** (Semmal) is Tamil for *a person of eminence*, one honoured for doing the work well. Every robot here
> earns that name job by job: it does the work, pays its own way and answers for the result.

SEMMAL is a robot-as-a-service marketplace where **every robot is its own autonomous agent**. A customer books a
robot near them; the robot's owner approves; the robot travels to the site, assesses it with its own camera, hires
the specialist AI agents it needs, pays them, asks **0G Private Computer** for a private decision inside a TEE, and
acts within strict safety limits. Everything it saw, bought and decided is signed by the robot's own key, stored on
**0G Storage** and indexed on **Arkiv**, and every robot and agent is **scored** on that evidence.

- **Web app:** https://semmal.vercel.app (the API runs on a long-lived host; see [docs/DEPLOY.md](docs/DEPLOY.md))
- **Supported robots:** iRobot Create 3 (home cleaning), Clearpath TurtleBot 4 (warehouse inspection), Clearpath Jackal
  (outdoor patrol). They run in **Gazebo** on an Ubuntu PC during development; see
  [Running on a real TurtleBot](#running-on-a-real-turtlebot).
- **Chains:** Arkiv Rabdi (chain 7794095) for records, 0G Galileo (chain 16602) for payments and Storage, 0G Router for inference.

## Screenshots

| | |
|---|---|
| ![Home](media/app-1-home.png) **Home** · the marketplace | ![Robot quote](media/app-2-robot-quote.png) **Book a robot** · the robot prices the job itself, from live Arkiv and 0G prices |
| ![Booking on Arkiv](media/app-3-booking-on-arkiv.png) **The booking** · signed by your wallet onto Arkiv, the robot's route on the map | ![What went to Arkiv](media/app-4-what-went-to-arkiv.png) **What went to Arkiv** · the job's entity read back, with the score worked through |
| ![Register a robot](media/app-5-register-robot.png) **Register a robot** · its identity checked by a signed challenge | |
| ![Simulation: living room](media/sim-1-living-room-toys.png) **The robot at work** · Gazebo, with the mission log and the robot agent's terminal | ![Simulation: record to 0G Storage](media/sim-2-dock-0g-storage-upload.png) **Back on its dock** · the robot uploads its signed record to 0G Storage, then Arkiv |

## ETHGlobal Mumbai submission

Built at ETHGlobal Mumbai (Nov 5–7, 2026); the repository's first commit is 2026-11-05 23:03 IST, after hacking began.
License: [MIT](LICENSE).

| | |
|---|---|
| **Project** | Semmal (செம்மல்): a robot-for-hire marketplace where each robot is its own agent. It prices the job, hires AI agents, decides with private 0G inference, pays in 0G and signs its own record on 0G Storage and Arkiv |
| **Live demo** | https://semmal.vercel.app (MetaMask currently flags every unverified `*.vercel.app` site as a "drainer", ours included; see [arkiv/friction.md](arkiv/friction.md) #3) |
| **Demo video** | coming soon (under 3 min; script in [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md)) |
| **Team** | Semmal: jonathan_vineet · Telegram [jonathan_vineet](https://t.me/jonathan_vineet) · X [jonathan_vineet](https://x.com/jonathan_vineet) |
| **Setup** | [Run it](#run-it), [docs/SCENARIOS.md](docs/SCENARIOS.md), [docs/ROBOT.md](docs/ROBOT.md), [docs/DEPLOY.md](docs/DEPLOY.md) |

### Contract and wallet addresses

We deployed **no contracts of our own**. Arkiv writes go to Arkiv's entity contract; payments are native 0G transfers
with a memo (`semmal:<kind>:<id>`), checked on chain by the robot.

| What | Address | Network |
|---|---|---|
| Arkiv entity contract (writes) | `0x4400000000000000000000000000000000000044` | Rabdi 7794095 |
| Robot `rbt-103e832a38` wallet: wrote quotes, job claims, episodes, incidents | `0x103E832a3801684eDEE9b82057F7a72Cb23629BC` | Rabdi; receives payments on 0G Galileo 16602 |
| Customer / agent owner: wrote bookings and agent listings | `0x2B5c206516c34896D41DB511BAB9E878F8C1C109` | Rabdi |
| Robot owners: wrote robot profiles | `0x2F1d5a41F58A5eD41b9fA88Af8645D7c3bc0b264`, `0x296654d5638Cf52783204830Dcb947A4c0e10De4` | Rabdi |

### Arkiv: Build on Arkiv (from scratch)

- **One query to run** (no key needed): `pnpm install && pnpm arkiv:query`. It runs
  `SELECT semmal_episode_v2 ORDER BY task_score DESC` and prints each robot-signed job with its score breakdown.
  Add a robot ID for `WHERE robot_id = …`: `pnpm arkiv:query rbt-103e832a38`.
- **Users read Arkiv data in:** the booking map and robot list, the Agent market, Your orders, the owner's requests,
  the evidence log, scores, and "What went to Arkiv" on every booking.
- Judging files: [arkiv/schema.md](arkiv/schema.md) · [arkiv/friction.md](arkiv/friction.md) ·
  [arkiv/reach.md](arkiv/reach.md) · [arkiv/why-arkiv.md](arkiv/why-arkiv.md) ·
  [arkiv/how-you-use-arkiv.md](arkiv/how-you-use-arkiv.md).

### 0G: Physical AI, Agents with a Body (simulated build: ROS 2 Jazzy + Gazebo)

| Requirement | Where |
|---|---|
| 0G call inside the decision loop | at every stop the robot sends one camera frame to a private 0G vision model and acts only on a checked answer: `services/robot-master/src/mission.ts` (stop loop), shown live in "How it decided" |
| Episode log on 0G Storage with a request ID per decision | each episode bundle is uploaded to 0G Storage, signed by the robot; `decisions[].providerRequestId` per decision; root + request IDs indexed on Arkiv (`services/robot-master/src/evidence.ts`) |
| Replayable simulation | deterministic, generated Gazebo worlds (house, warehouse, forest) launched from a clean setup with `scripts/robot/scenario.sh <world>`; shown in the demo video |
| Safe stop if 0G is unreachable, no faked decision | no answer, a late answer or a rejected answer: the robot holds, retries once, then `SAFE_STOP`, nothing invented (tested: "0G fails twice: hold, SAFE_STOP, nothing invented"); motor faults stop it locally with no network |

0G is the brain, not the spinal cord: motion, navigation and the safety supervisor run in ROS 2 on the robot; 0G makes
the decision at each checkpoint, and the record goes to 0G Storage.

### 0G: Build with 0G Private Computer

- **Main flow:** every booked job runs private (TEE, `0gm-1.0-35b-a3b`) inference on 0G Router at each stop. The
  customer sees each request ID, model, trust mode, latency, cost and the answer under "How it decided".
- **What breaks if 0G is removed:** the robot cannot decide anything at a checkpoint, so it holds and safe-stops: no
  inspection, no cleaning, no job completed, and no agent is paid.
- **Why come back tomorrow:** recurring jobs (cleaning, inspections, patrols) by robots whose signed record and score you
  can check before you book.

### How AI was used

- **To build it:** the code and docs were written with an AI coding assistant (Claude Code, Anthropic), directed and
  reviewed by the team. No other AI tools were used to build it.
- **In the product:** 0G Private Computer models make the robot's checkpoint decisions (vision). Model output is
  advisory: it is schema-checked, it can only choose from five allowed actions, it never controls motors, money or
  keys, and a missing or invalid answer means a safe stop.

---

## The flow

```
Customer books (wallet-signed booking on Arkiv; the address goes to the robot only)
  → robot prices the job from live costs and sends its offer
  → the robot's OWNER approves (nothing moves before this)
  → robot travels to the site, live on the map
  → robot arrives; the CUSTOMER confirms it is really there   ← only now is the booking fully started
  → customer pays the offer in 0G; the robot checks the payment on chain itself
  → robot assesses the site: drives to each stop, takes a camera frame
  → robot hires and pays its vision agent (0G on Galileo); the agent's runner checks the payment on chain
  → 0G Private Computer: the frame is analysed in PRIVATE mode, inside a TEE; request ID and receipt come back
  → robot checks the answer (format, allowed action, confidence) and acts within bounds (clear, hold, report)
  → in a house, clutter and spills are the robot's own job: it drives to the toys, picks them up, puts them
    in the toy bin and wipes the kitchen spill (Gazebo moves the props: the body has no gripper); nobody is asked
  → robot settles: margin to the owner if done, the unspent rest back to the customer if not
  → evidence: signed episode bundle → 0G Storage (root) → Arkiv episode record
  → scores: robot and agents are scored on the evidence; bad ones are excluded from booking and hiring
```

| Step | Code |
|---|---|
| Booking, offer, approval, confirmation, payment | `apps/web/src/components/BookTask.tsx`, `apps/api/src/app.ts` (`/api/tasks/:id/{dispatch,approve,confirm-arrival,payment}`) |
| The robot's whole task loop | `services/robot-master/src/mission.ts` (`runTask`) |
| Travel along a road route | `mission.ts` (travel block), `apps/api/src/route.ts` (OSRM) |
| Camera frame from Gazebo | `ros2_ws/src/semmal_mission` (`_capture`), `ros2_ws/src/semmal_gateway` (`/keyframe`) |
| Hiring and paying an agent | `mission.ts` (`job`), `services/robot-master/src/device.ts` (`pay`) |
| Payment checked before 0G is called | `apps/api/src/runner.ts` (`run`, payment check), `packages/zerog-pay` (`verifyTransfer`) |
| 0G Private Computer call | `packages/zerog-pc-adapter/src/index.ts` (`chat`): `POST /chat/completions`, `X-0G-Provider-Trust-Mode: private`, `verify_tee` |
| Each agent's own capped 0G key | `apps/api/src/runner.ts` (`agentKey`), `zerog-pc-adapter` (`createKey`, `setKeyLimit`) |
| How it decided (customer view) | `apps/web/src/components/ComputeView.tsx`, `/api/tasks/:id/compute` |
| Evidence to 0G Storage and Arkiv | `services/robot-master/src/evidence.ts`, `device.ts` (`storageUpload`, `arkivCreate`) |
| Evidence verified on download | `apps/api/src/verify.ts`, `apps/web/src/components/RobotEvidence.tsx` |
| Scores | `packages/contracts/src/index.ts` (`scoreRobot`, `scoreAgent`), `/api/scores`, `apps/web/src/components/Scores.tsx` |

---

## Why each piece is used

| Piece | What it does here | Why it is needed |
|---|---|---|
| **0G Private Computer** (Router) | Runs the vision model that decides what the robot does at each stop, in **private mode** on TEE hardware, and returns a request ID, provider, cost and TEE verification | The camera sees a customer's home. Private mode means the frame is processed inside a sealed enclave, and the request ID makes every decision checkable. Without 0G the robot cannot decide, so it holds and stops safely rather than guess. |
| **0G Galileo** (native 0G) | Customer → robot, robot → agent owner, robot → owner/customer payments | Real, checkable money flow; each payment carries a memo (`semmal:quote:…`, `semmal:job:…`) so one transfer pays exactly one thing. |
| **0G Storage** | Holds each signed episode and incident bundle | Large evidence off the index, verifiable against its root with a proof on download. |
| **Arkiv** | Registry of robots and agents, bookings, offers, job claims, episode and incident indexes, score checkpoints | Queryable records with owners and lifetimes; anyone can check who wrote what and when. |
| **ROS 2 Jazzy + Gazebo Harmonic** | Drives the robot, camera, lidar, safety supervisor | The physical side, deterministic and testable before real hardware. |
| **The robot's device key** | Signs the robot's evidence, identity challenges and its capped payments | Evidence is written automatically by the robot; no person can alter or withhold it. |

---

## Autonomous, and built so a failure ends in a safe, recorded stop

The robot runs the job on its own; people only approve and confirm. Every way it can go wrong is designed to end
in a safe, explained, recorded state, never in a guessed action:

- **Safety never waits for AI or the network.** The ROS safety supervisor (`ros2_ws/src/semmal_safety`) is the only
  thing that commands the wheels. A motor overcurrent, a stale sensor or a lost heartbeat stops the robot locally and
  latches; only an operator-approved recovery clears it. Tests: `tests/robot`.
- **AI is advisory and bounded.** A 0G answer must be one JSON object in the exact format, recommend one of four
  allowed actions, and reach confidence 0.6 (`mission.ts`, `ACTIONS`, `CONFIDENCE_FLOOR`). Anything else is rejected.
  The robot never sends motor commands from model output; it only requests named waypoints the mission executor allows.
- **No invented decisions.** If 0G is unreachable, slow, returns a bad answer or cannot serve private mode, the robot
  holds (`WAITING_FOR_0G`), retries once, then stops safely (`SAFE_STOP`). It never downgrades private mode.
- **Only agents that can serve their promise are hired.** A private agent whose model has no TEE provider in the live
  0G catalog is skipped; excluded agents (bad score) are never offered.
- **People stay in charge of the risky moments.** The owner approves every booking before the robot moves; the
  customer confirms the robot is really on site before paying.
- **Money is bounded.** The robot's key pays only allowlisted recipients (agent owners from Arkiv, its owner, the
  paying customer), never more than the customer paid, with per-payment and daily caps, exactly once per payment
  (`device.ts`, `pay`). Every payment is checked on chain by the receiver.
- **Evidence is automatic.** The robot signs and uploads its own records; a slow chain write never blocks the job.

## How a robot is verified before it goes on chain

Registration starts with **Connect** (`/robots/new`):

1. The robot's **identity node** (`ros2_ws/src/semmal_identity`) reports which supported robot it is: model, runtime,
   the robot description actually loaded and its sensors, ROS and OS, its base location to about 1 km. No serials,
   hostnames or exact location.
2. The **device identity service** (`services/robot-master/src/identify.ts`) signs those facts with the robot's own
   key over a fresh challenge from the platform.
3. The platform (`apps/api/src/connect.ts`) checks the signature belongs to the robot's wallet, the challenge is fresh
   (no replay), the facts were not edited, and the facts match a supported robot (`detectHardware`).
4. Only then does the wizard fill in the model, wallet and base, and the owner's wallet publishes the profile on Arkiv,
   with the signed identity inside it so anyone can re-check it.

The facts are reported by the robot's own software: they prove what it runs and that it holds its key, not physical
hardware (that needs a TPM).

## Scores: no bad robots or agents get in

Implemented in `packages/contracts` (`scoreTask`, `scoreRobot`, `scoreAgent`; formulas **task-score-v1** and
**score-v2**), served by `/api/scores`, shown in the dashboard and next to each robot when booking, and on Arkiv.

- **Every job is scored by the robot itself** (`scoreTask`, task-score-v1), from its own episode, before the episode
  is signed and stored. Parts that do not apply are left out of the total:

  | Part | Points | Input |
  |---|---|---|
  | Stops completed | 40 | stops visited / stops planned (accepted customer extras count as planned) |
  | Valid 0G decisions | 20 | 0G answers that passed the robot's checks / answers asked for |
  | Findings dealt with | 20 | findings cleared, reported or held for inspection as the job says / findings |
  | Extra stops done | 10 | extras done / extras the robot accepted |
  | On time | 10 | finished by the booking's deadline |

  `score = round(100 × points / max of the judged parts)`. After a safe stop only the decisions part counts: a correct
  safe stop is never misconduct. The score goes into the signed 0G Storage bundle and into the Arkiv episode entity
  (`semmal_episode_v2`, with `task_score` as an indexed column).
- **Robots** (score-v2): the mean job score of their completed and failed episodes on Arkiv (an older episode without a
  score counts 100 if completed, 0 if failed), minus up to 20 for hardware incidents. Safe stops and customer
  cancellations are **not** counted against the robot.
- **Extra stops during a job:** while the robot works, the customer can ask for another place (`POST
  /api/tasks/:id/extras`). The platform only passes it on; the robot decides: the place must suit the job in its world,
  not already be planned, at most 3 extras, and the customer's payment must still cover every remaining check plus this
  one. Each request and answer is in the episode.
- **What went to Arkiv:** each booking shows the episode entity read back from Arkiv (`GET /api/tasks/:id/record`):
  schema, indexed columns, the stored body, owner, expiry, and the job score and robot score worked through.
- **Agents are scored by the robots that hire them** (`scoreAgentJob`, agent-job-score-v1): for every job it paid for,
  the robot records delivered before the deadline (40), passed its checks: format, allowed action, confidence, or a
  usable route plan (40), and speed (20 within half the deadline, 10 within it). These job scores go into the robot's
  signed episode and its Arkiv entity (`agentJobs`). An agent's score (score-v2) is the mean of the job scores robots
  gave it; until a robot has scored it, the runner's record of its paid jobs is used. A job that never ran because of
  the robot (not paid, over budget, rejected input) is not counted against the agent.
- **Selection uses the scores, on both sides.** The selection score is the reputation pulled toward a neutral 70 while
  there is little evidence: `round((judged × score + 3 × 70) / (judged + 3))`; excluded means never selected.
  - **Booking:** robots that cover the site come first, ranked by selection score (5-point bands), then distance.
  - **Hiring:** a robot hires, for each kind it needs, the agent with the best selection score (5-point bands) that
    meets the job's trust mode, then stronger trust, then lower price (`rankSpecialists` in `packages/quote`). If that
    agent cannot serve, it hires the next one in the same order.
- **Exclusion:** with 5 or more judged jobs and a score under 40, or no activity for 180 days, a robot or agent is
  **excluded**: it is not shown for booking and no robot will hire it. New ones (under 3 judged jobs) are marked new.
- **On Arkiv:** the instance owner publishes **score checkpoints** (`semmal_reputation_v1`, formula score-v2), each living about 4 months;
  publishing again refreshes it. Registrations live 3 months and are renewed by re-publishing; an excluded robot or
  agent is simply not renewed and lapses.
- **Logs:** each operation's evidence is collected when it completes, signed, stored on 0G Storage and indexed on Arkiv
  for about 4 months.

## Everything is checkable on chain

The app links each record to its block explorer (`apps/web/src/lib/explorers.ts`):

| What | Where in the app | Explorer |
|---|---|---|
| Robot profile, agent listing, booking, score checkpoint, episode/incident record | registration and publish screens, dashboard, Your orders, Evidence log, Scores | Arkiv `rabdi.explorer.arkiv.network/entity/…`, `/tx/…` |
| Robot wallet | dashboard (on Arkiv and on 0G Galileo), booking panel | `/address/…` on both explorers |
| Customer payment, agent payments, owner payout, refund | booking panel, How it decided, Evidence log | 0G `chainscan-galileo.0g.ai/tx/…` |
| 0G inference | How it decided: 0G request ID, provider, TEE verification, cost | 0G Router receipt |
| Evidence bundle | Evidence log: downloaded from 0G Storage with proof; content hash, robot signature and Arkiv link checked | 0G Storage root |

## Privacy

- Camera frames stay on the robot. One copy goes to the vision agent for a single private (TEE) 0G call and is not
  stored or shown anywhere, including in this app.
- Arkiv holds only a robot's base to about 1 km. The customer's address goes from their browser to the robot through
  the platform and never onto Arkiv or into evidence; evidence keeps trip points to about 1 km.
- No private key exists on the platform. People sign in their own wallet; the only key is each robot's device key,
  stored on the robot PC (`~/.semmal/robots/<name>/robot-key`, mode 600).

---

## Running on a real TurtleBot

The robot stack is already ROS 2 Jazzy, the TurtleBot 4's own stack. Moving from Gazebo to a real TurtleBot 4 (or
Create 3, or Jackal) is mostly bring-up, not new code:

- Replace the Gazebo launch with the robot's own drivers (`turtlebot4_bringup`), keep the SEMMAL nodes (safety,
  mission, gateway, identity) and launch with `runtime:=hardware`.
- Point the mission executor at real odometry and the robot's Nav2 setup, and map the motor diagnostics to the real
  battery and motor topics.
- Add the on-board evidence rule for real hardware to `detectHardware` (it refuses `runtime: hardware` until that rule
  is tested on the robot).
- Install the robot agent as a service (`scripts/robot/install_service.sh`) and run `pnpm setup` once on the robot.

The platform, payments, 0G and Arkiv parts do not change.

---

## Repository

```
apps/web                 Next.js app (Vercel): booking, orders, dashboard, maps, How it decided, evidence, scores
apps/api                 Fastify API: registry reads, quotes, robot gateway (WebSocket), agent runner, connect, scores
services/robot-master    The robot's own agent on the robot PC: task loop, device key, payments, evidence, identity
packages/contracts       Shared schemas and pure rules (hardware detection, scores, location)
packages/arkiv-adapter   Arkiv schemas, encoders, registry reads, guarded one-shot wallet writer
packages/zerog-pc-adapter  0G Router client (private mode, TEE verification, per-agent keys)
packages/zerog-pay       0G Galileo payment memos and on-chain transfer checks
packages/quote           Deterministic task pricing in 0G
ros2_ws/src              ROS 2 packages: description, Gazebo worlds, safety, diagnostics, mission, gateway, identity, …
docs/                    FACT_CHECK (verified facts and sources), SCENARIOS, DEMO_SCRIPT, DEPLOY, ROBOT
```

## Run it

| Where | Commands |
|---|---|
| Mac (platform) | `pnpm install` · `pnpm dev:api` · `pnpm dev:web` (or the Vercel site, see [docs/DEPLOY.md](docs/DEPLOY.md)) |
| Ubuntu 24.04 (robot) | `scripts/robot/build.sh` · `cd services/robot-master && pnpm install && pnpm setup house` · `scripts/robot/scenario.sh house` · `pnpm start house` |

Step-by-step test scenarios: [docs/SCENARIOS.md](docs/SCENARIOS.md). Three-minute demo: [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).
Environment variables: `.env.example` (platform) and `services/robot-master/.env.robot.example` (robot).

## Tests

`pnpm test` (API 80, robot agent 58, payments 3) and `python3 -m pytest tests/robot` (ROS logic, 68). They cover the
task flow, payments and caps, never paying twice, 0G failure handling, robot identity, routing, notifications,
access control and scores.

## Honest limits

- Gazebo is not proof of real-world reliability; real hardware needs the bring-up above.
- Robot identity facts are self-reported by the robot's software (no TPM).
- Only `0gm-1.0-35b-a3b` currently offers private (TEE) vision on the 0G Router.
- Each agent's 0G key draws on one Router deposit: a per-agent spend cap and usage record, not a separate wallet;
  topping up that deposit is manual.
- No escrow contract: the customer pays after confirming arrival and trusts the robot until completion; unspent money
  is refunded automatically if it cannot finish.
- Arkiv records prove what was recorded and by whom, not that a sensor told the truth.
