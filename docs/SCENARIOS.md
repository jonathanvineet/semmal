# Three test scenarios: house cleaning, warehouse inspection, forest patrol

Each scenario is one supported robot, running in Gazebo on the Ubuntu PC as a stand-in for the real
hardware, with its own wallet and its own identity. They run one at a time on the robot PC
(Ubuntu 24.04, ROS 2 Jazzy, Gazebo Harmonic).

| Scenario | Hardware | World | Skill | Stops the robot picks | What the camera should find |
|---|---|---|---|---|---|
| House | iRobot Create 3 | `house` | `home.cleaning` | kitchen → living_room → bedroom → dock | coffee spill (kitchen), toys (living room), nothing (bedroom: the clean control) |
| Warehouse | Clearpath TurtleBot 4 | `warehouse` | `warehouse.inspection` | inspection_point_A | carton blocking the machine panel's lower vent |
| Forest | Clearpath Jackal | `forest` | `outdoor.patrol` | creek_crossing → log_check → fire_lookout → dock | nothing (creek), fallen log across the path, smouldering campfire with smoke |

What the robot does with a finding depends on the job:
- **cleaning**: it makes a cleaning stop at that spot, then goes to the next room. The body has no brush or vacuum modelled, so the cleaning stop is an 8 s hold on the spot, and the evidence says exactly that.
- **inspection**: it holds for a human and finishes.
- **patrol**: it reports the hazard and carries on.

The vision agent's answer is advisory. A missing, late, malformed or low-confidence answer holds the robot (`WAITING_FOR_0G`), retries once, then `SAFE_STOP`. Nothing is invented.

## The evidence log (per episode)

Each episode is signed by the robot's own key, uploaded to 0G Storage and indexed on Arkiv. The dashboard downloads it with proof and checks it.

| Section | What it holds |
|---|---|
| **What it accessed** | Its own state (ROS gateway), its Arkiv profile, the agent listings, the 0G model prices, and every camera frame: where it was taken, that it stayed on the robot, and that one copy went to the named vision agent. |
| **What it bought** | Every agent job: agent, what for, price in 0G, the payment transaction to the agent's owner, delivered or not, 0G request ID, model and trust mode. |
| **Money** | Who paid (the customer, or the robot's own balance on a test task), the customer's payment transaction, the agent budget, the total paid to agents, and the margin sent to the owner or the refund sent to the customer, each with its transaction. |
| **What 0G told it** | Per stop: what was seen, what was found, confidence, the robot's verdict (accepted or rejected), request ID and latency. |
| **What it did** | Cleaning stop, hold for a human, hazard reported, nothing to do, return. |
| **Every state change** | The task state machine with reasons. |

No image bytes, prompts or personal data go into the bundle.

## Before you start (platform Mac)

1. `.env` has `ZEROG_ROUTER_API_KEY`, `ARKIV_ACCESS_KEY` and `API_HOST=0.0.0.0`. Optional but recommended: `ZEROG_ROUTER_MANAGEMENT_KEY` (pc.testnet.0g.ai → Settings → Management Keys → "Key Manager"). With it, every agent gets its own 0G key capped at `ZEROG_AGENT_CREDIT_LIMIT` (default 0.5 0G) per day; one vision call costs about 0.02 0G. `ZEROG_USDC_RATE` is no longer used; everything is in 0G.
2. In /admin there is a **vision** agent published with trust mode **private**, priced in **0G**, on a 0G model that accepts images. Agents published before this change are priced in USDC; robots skip them, so publish the vision agent again. Test it once in "Run an agent". A **navigation** agent is optional; if one exists, the robot hires it to order its stops.
3. Restart the API after pulling: `pnpm --filter @semmal/api dev`.

## How a robot proves who it is

- **Identity node** (`semmal_identity`, starts with the robot stack). It reports which robot this is: the model, the runtime (Gazebo here), the robot description actually loaded and its sensors, ROS and OS, and a salted machine hash. No serials, MACs or hostnames.
- **Device identity service** (inside `pnpm start <name>`, port 8770). When the platform connects, it sends a fresh challenge. The robot answers with those facts, signed with its own wallet key.
- **The platform checks four things:**
  - the signature belongs to the wallet;
  - the challenge is fresh, not a replay;
  - the facts were not edited;
  - the facts match a supported robot: the right description body with the expected sensors.

  Only then does the wizard fill in the model and the wallet, and lock them.
- **What it does not prove:** the facts come from the robot's own software, so they are not a hardware attestation (that would need a TPM). Running as real hardware is refused until its on-board check has been tested.

## On the robot PC: set up each robot once

```bash
git pull && scripts/robot/build.sh            # builds the worlds, the bodies and semmal_identity
cd services/robot-master && pnpm install
pnpm setup house                              # then: pnpm setup warehouse, pnpm setup forest
```

Setup asks, in the terminal:
1. Which hardware: house → Create 3, warehouse → TurtleBot 4, forest → Jackal.
2. The robot's wallet: **[g]** generates a new one, or **[i]** imports a private key you created (typed hidden).
3. Where the robot is based (latitude, longitude, e.g. from a map app) and how far it will travel for a job. Only a ~1 km version is ever published.
4. The platform address, `http://<mac-ip>:<api-port>`.
5. Your Arkiv access key (hidden).
6. The link token (leave it empty for now).

For testing, give the three robots bases a few km from where you'll book. To watch a trip without waiting for real driving time, add `SEMMAL_TRAVEL_SPEEDUP=20` to `~/.semmal/robots/<name>/robot.env`; the robot then travels 20× faster than the road estimate (a development setting only).

Everything is saved in `~/.semmal/robots/<name>/`, owner-only. Run setup again any time to change something; the wallet is never replaced. Never paste a private key anywhere else, including a chat.

Fund **each** robot wallet with tGLM (https://hub.arkiv.network/faucet) for Arkiv writes, and 0G (https://faucet.0g.ai, about 0.1 0G a day) for Storage, gas and owner test tasks. You also need 0G in your own wallet (the customer) on 0G Galileo; the app adds the network the first time you pay.

## Register and link each robot

```bash
scripts/robot/scenario.sh house     # terminal 1: Gazebo + robot stack (+ identity node); the world follows the hardware
cd services/robot-master && pnpm start house    # terminal 2: identity service, then the robot's agent once linked
```

Terminal 2 prints the robot wallet and "register at /robots/new by connecting to <ip>". In the browser, at /robots/new:
1. Nickname.
2. **Connect**: enter that IP, then Connect. Expect four ✓ checks, "Supported robot: iRobot Create 3", its facts, and a map of its base (about 1 km).
3. Skills (from that robot's list), area, then pricing. Defaults in 0G: minimum fee **0.01**, maximum quote **0.15**, max spend per task **0.1**. A vision job costs about 0.02 0G, so the house run quotes about 0.08.
4. Robot wallet: already filled in from the robot.
5. Publish (your wallet signs).

Then /admin → Your robots → **Link robot** → copy the token. In a third terminal on the robot PC run `pnpm setup house`, press Enter through the answers, and paste the token. Terminal 2 picks it up within 5 seconds and links. The robot shows **Online** in /admin.

Repeat for warehouse and forest, one at a time (Ctrl-C both terminals, or `scripts/robot/stop_sim.sh`, in between).

**As an installed service:** after setup, `scripts/robot/install_service.sh house` runs `pnpm start house` as the systemd user service `semmal-robot@house`. It starts with the PC and restarts on failure; installing one robot stops the others. Logs: `journalctl --user -u semmal-robot@house -f`.

## Run a scenario

Start the robot as above: `scenario.sh <name>` plus `pnpm start <name>` (or the installed service). Then there are two ways to start a job:

- **As a customer (the full payment flow):** on /quote, set **Where** (Use my location, or click the map). Robots are listed nearest first; ones outside their travel radius are greyed out. Pick a robot and the job, then choose **On site at**: the earliest time is the drive time plus 15 minutes. Then **Book**. Your address goes to the robot only, never onto Arkiv. The booking is signed on Arkiv by your wallet. The robot replies with a signed offer, and you click **Pay X 0G to the robot**, which your wallet confirms on Galileo. The robot checks the payment on chain and sets off so it arrives on time. The booking map shows its route and live position. Once it's on site it starts the job (the Gazebo run), paying each agent's owner before each job. At the end it sends the margin to you as the owner, or refunds the customer if it could not finish.
- **As the owner (quick test):** click **Send task: home.cleaning** (or `warehouse.inspection` or `outdoor.patrol`). No customer pays; the robot pays its agents from its own balance, up to max spend per task.

Then:

1. **Gazebo:** the robot drives to each stop, stops, looks, and either makes a cleaning stop, holds, or carries on.
2. **Terminal 2 (or the service log):** the robot's own log: quote, hires, 0G answers, actions, evidence stages (LOCAL_DURABLE → STORAGE_CONFIRMED → ARKIV_CONFIRMED).
3. **/admin → that robot → Evidence log:** the episode appears once it is on Arkiv. Click it to download it from 0G Storage with proof. Four checks should be green, followed by the sections above.

**Optional fault:** during a run, `scripts/robot/inject_fault.sh left_motor_overcurrent`. The robot stops at once, with no network or AI involved. The episode ends `SAFE_STOP`, and an incident appears in the evidence log too. Recover with `scripts/robot/recover.sh <your-name> "checked motor"`.

**0G failure test:** unplug the platform's internet mid-run. The robot holds, retries once, then `SAFE_STOP`. The "What 0G told it" table shows `failed` or `timeout` with no made-up answer.

## Known limits

- The vision model sees rendered Gazebo frames. The models may misjudge a flat spill or call the smoke a pillar; that is a real result and is shown as such. A low-confidence answer is rejected.
- Payments are real 0G transfers on the Galileo testnet. There is no escrow contract, so the customer trusts the robot between paying and completion. The robot refunds what it did not spend if it cannot finish.
- With a management key, each agent has its own capped 0G key, but all keys draw on one Router deposit (yours). It is a per-agent spend cap and usage record, not a separate wallet.
- Getting to the customer is a drive along a real road route (OSRM demo server, cached, at most 1 request a second; a direct line if it's unreachable, and the map says so). The robot reports its position along that route; Gazebo then runs the job at the site. In production this is a real vehicle and GPS.
- The identity proves the robot holds its wallet key and runs a supported robot's stack. The facts are self-reported (no TPM), and real Create 3, TurtleBot 4 and Jackal hardware is not accepted until its on-board check is tested.
- One simulation at a time per PC. Each robot keeps its own task store and evidence queue (`data/robot-master/<rbt-id>`) and only signs incidents carrying its own robot id.
