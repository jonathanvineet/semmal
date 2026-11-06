# Three test scenarios: house cleaning, warehouse inspection, forest patrol

Each scenario is one world, one robot body and one robot registered on Arkiv with its own device key.
They run one at a time on the robot PC (Ubuntu 24.04, ROS 2 Jazzy, Gazebo Harmonic).

| Scenario | World | Body | Skill | Stops the robot picks | What the camera should find |
|---|---|---|---|---|---|
| House | `house` | `cleaner` (round white disc, blue bumper) | `home.cleaning` | kitchen → living_room → bedroom → dock | coffee spill (kitchen), toys (living room), nothing (bedroom: the clean control) |
| Warehouse | `warehouse` | `rover` (graphite + orange) | `warehouse.inspection` | inspection_point_A | carton blocking the machine panel's lower vent |
| Forest | `forest` | `field` (olive, roll bar, amber beacon) | `outdoor.patrol` | creek_crossing → log_check → fire_lookout → dock | nothing (creek), fallen log across the path, smouldering campfire with smoke |

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

## On the robot PC

```bash
git pull && scripts/robot/build.sh            # builds the forest world and the new bodies
cd services/robot-master && pnpm install

# one device key per robot. Each prints its address.
SEMMAL_ROBOT_KEY_FILE=~/.semmal/robot-key-house     pnpm keygen
SEMMAL_ROBOT_KEY_FILE=~/.semmal/robot-key-warehouse pnpm keygen
SEMMAL_ROBOT_KEY_FILE=~/.semmal/robot-key-forest    pnpm keygen
```

Fund **each** address with test tGLM (https://hub.arkiv.network/faucet) for Arkiv writes, and 0G (https://faucet.0g.ai, about 0.1 0G a day) for Storage uploads, gas and owner test tasks. Each robot prints its 0G balance when it starts.

You also need 0G in your own wallet (the customer), on the 0G Galileo network. The app adds the network to your wallet the first time you pay.

## Register the three robots (browser, owner wallet)

At /robots/new, once per robot:

| | Model | Skills | Robot wallet |
|---|---|---|---|
| House | Home cleaning robot | Home cleaning | robot-key-house address |
| Warehouse | Compact rover | Inspection | robot-key-warehouse address |
| Forest | Field rover | Outdoor patrol | robot-key-forest address |

Guardrails, in 0G (the defaults fit testnet amounts): minimum fee **0.01**, maximum quote **0.15**, max spend per task **0.1**. A vision job costs about 0.02 0G (its 0G inference plus the agent's margin, about 1,500 input and 800 output tokens), so the house run (three jobs) costs about 0.065 0G in agents and quotes about 0.08 0G. Keep the maximum quote at or below the robot's `ROBOT_MAX_PAYMENT_0G` (0.15), since the margin goes back to you as one payment. Note each robot's `rbt-…` id.

Robots registered before this change are priced in USDC and decline paid tasks. Delete them in /admin and register them again.

Then in /admin → Your robots → **Link robot** for each. Copy the command, change the `KEY=` line to that robot's key file, fill in `ARKIV_ACCESS_KEY=`, and run it on the robot PC. It writes `services/robot-master/.env.robot.<rbt-id>` (git-ignored). Stop it with Ctrl-C once it says it is linked; you start it per scenario below.

## Run a scenario (repeat for each)

```bash
# terminal 1: world + body + ROS stack
scripts/robot/scenario.sh house rbt-xxxxxxxxxx          # or warehouse / forest with that robot's id

# terminal 2: the robot's own agent
cd services/robot-master && SEMMAL_ENV_FILE=.env.robot.rbt-xxxxxxxxxx pnpm start
```

In /admin, that robot shows **Online**. There are two ways to start a job:

- **As a customer (the full payment flow):** on /quote, pick the robot and the job, then **Book**. The booking is signed on Arkiv by your wallet. The robot replies with a signed offer, and you click **Pay X 0G to the robot**, which your wallet confirms on Galileo. The robot checks the payment on chain, then pays each agent's owner before each job. At the end it sends the margin to you as the owner, or refunds the customer if it could not finish.
- **As the owner (quick test):** click **Send task: home.cleaning** (or `warehouse.inspection` or `outdoor.patrol`). No customer pays; the robot pays its agents from its own balance, up to max spend per task.

Then:

1. **Gazebo:** the robot drives to each stop, stops, looks, and either makes a cleaning stop, holds, or carries on.
2. **Terminal 2:** the robot's own log: quote, hires, 0G answers, actions, evidence stages (LOCAL_DURABLE → STORAGE_CONFIRMED → ARKIV_CONFIRMED).
3. **/admin → that robot → Evidence log:** the episode appears once it is on Arkiv. Click it to download it from 0G Storage with proof. Four checks should be green, followed by the sections above.

Ctrl-C both terminals (or `scripts/robot/stop_sim.sh`) before the next scenario.

**Optional fault:** during a run, `scripts/robot/inject_fault.sh left_motor_overcurrent`. The robot stops at once, with no network or AI involved. The episode ends `SAFE_STOP`, and an incident appears in the evidence log too. Recover with `scripts/robot/recover.sh <your-name> "checked motor"`.

**0G failure test:** unplug the platform's internet mid-run. The robot holds, retries once, then `SAFE_STOP`. The "What 0G told it" table shows `failed` or `timeout` with no made-up answer.

## Known limits

- The vision model sees rendered Gazebo frames. The models may misjudge a flat spill or call the smoke a pillar; that is a real result and is shown as such. A low-confidence answer is rejected.
- Payments are real 0G transfers on the Galileo testnet. There is no escrow contract, so the customer trusts the robot between paying and completion. The robot refunds what it did not spend if it cannot finish.
- With a management key, each agent has its own capped 0G key, but all keys draw on one Router deposit (yours). It is a per-agent spend cap and usage record, not a separate wallet.
- One simulation at a time per PC. Each robot keeps its own task store and evidence queue (`data/robot-master/<rbt-id>`) and only signs incidents carrying its own robot id.
