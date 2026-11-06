# Demo (under 3 minutes): a cleaning robot booked, approved, delivered, and deciding with 0G

## Set up before you start (not on camera)

- **Mac:** `pnpm dev:api`, `pnpm dev:web`.
- **Two browsers:**
  - Owner: signed in at /admin with the robot owner's wallet.
  - Customer: signed in with a second wallet, on /quote, with **Where** set a few km from the robot's base.
- **Robot PC:**
  - `scripts/robot/scenario.sh house` (Gazebo on screen).
  - `cd services/robot-master && pnpm start house`.
  - Add `SEMMAL_TRAVEL_SPEEDUP=30` to `~/.semmal/robots/house/robot.env` so the trip takes seconds.
- **On Arkiv:** the robot is registered via Connect, and a private **vision** agent priced in 0G is published.
- **Funds:**
  - customer wallet: tGLM on Rabdi (booking) and 0G on Galileo (payment);
  - robot wallet: 0G (agent payments, gas) and tGLM (evidence).
- Book with **2 stops** to keep the run short: kitchen (spill) and living room (toys).

## Script

| Time | On screen | Say |
|---|---|---|
| 0:00 | Customer: /quote map, robots nearest first | "I need my house cleaned. SEMMAL shows the robots near me, from their records on Arkiv." |
| 0:15 | Pick *house* (iRobot Create 3), Home cleaning, **As soon as possible**, Book (wallet signs on Rabdi) | "The booking goes on Arkiv; my address goes only to the robot." |
| 0:30 | Owner browser: bell → **Booking requests** → Approve | "The robot's owner approves. Nothing moves before that." |
| 0:40 | Customer: Your orders → the order, map: robot driving along the road route | "The robot travels to me; I see it live." |
| 0:55 | Bell: "has arrived: please confirm" → **Yes, it's here** → **Pay** (wallet, 0G on Galileo) | "I confirm it's really here, then pay. The robot checks the payment on chain itself." |
| 1:15 | Gazebo: the robot drives to the kitchen, camera on its mast | "Now it works. It looks with its own camera..." |
| 1:30 | Order → **How it decided**: show the picture, model, private mode, 0G request ID, TEE check, cost, the answer, the robot's checks | "...hires a vision agent, pays it, and the agent asks 0G in private mode, inside a TEE. Here is the exact picture, the request ID, and the answer. The robot only accepts an answer in the right format, with an allowed action and enough confidence." |
| 2:05 | Gazebo: cleaning stop at the spill, then the living room | "It found the spill, cleans there, and moves on." |
| 2:30 | Evidence log: episode verified (0G Storage proof, signature, Arkiv) with money section | "Everything it saw, bought and decided is signed by the robot's own key, stored on 0G Storage and indexed on Arkiv." |
| 2:45 | (optional) `scripts/robot/inject_fault.sh left_motor_overcurrent` → stops instantly | "Safety never waits for AI: a motor fault stops it locally, with no network." |

## If something goes wrong on camera

- **No 0G answer:** the robot holds, retries once, then stops safely. Nothing is invented; say so.
- **Offer or Arkiv slow:** the offer also arrives straight through the platform, so payment still works.
