# Reach

## Who is it for, and would they use it?

- **People who need a job done by a robot**: a home cleaned, a warehouse panel inspected, a site patrolled. They book
  a robot near them, pay in 0G when it arrives, and get a signed record of what it did and how it decided.
- **Robot owners** who want their robot to earn when it is idle. They register it once (its identity is checked by a
  signed challenge), set a pricing policy, approve bookings, and get the margin when a job completes.
- **AI agent developers** who sell a skill (vision, inspection, maintenance, route planning) per job. Robots discover
  them on Arkiv and pay them in 0G with no contract or sales call; a good record makes robots hire them first.

Why they would use it: the robot does the coordination itself (pricing, hiring, paying, reporting), and the customer
doesn't have to trust the marketplace, because the robot's record and score are on Arkiv under the robot's own key.

## Can they try it today?

- **Live:** <https://semmal.vercel.app>. Browse the agent market and robots, and see a booking's record read back from
  Arkiv. Booking and paying need a wallet on Rabdi (tGLM) and 0G Galileo (testnet 0G).
  Note: MetaMask's domain scanner currently flags every unverified `*.vercel.app` site, ours included, as a "drainer"
  (it does the same for random `vercel.app` names). Use a local run, or a custom domain once one is attached.
- **A robot:** any Ubuntu 24.04 PC with ROS 2 Jazzy + Gazebo runs a robot in a house, warehouse or forest world,
  links to the platform and takes paid jobs. Steps: [docs/ROBOT.md](../docs/ROBOT.md) and the README's "Run it".
- **Query the data** with no account: `pnpm arkiv:query` ([how-you-use-arkiv.md](how-you-use-arkiv.md)).

## Numbers so far (testnet, 2026-11-07)

2 robots and 2 agents registered; 5 bookings; 7 completed or stopped jobs on record (1 already scored 100/100); 21
safety incidents recorded by the robot's own key; every vision decision made by a private 0G model with its request
ID on record.

## After Mumbai

Yes, Semmal continues after Mumbai. I come from computer science, and hardware, especially AI agents that live in
real machines, is what I want to build. Next:

- run the same robot agent on a real TurtleBot 4 / iRobot Create 3 (the bring-up is in the README);
- more agent kinds that robots can hire (inspection, maintenance, route planning) from other developers;
- a custom domain, so wallets stop flagging the shared `vercel.app` address;
- longer-lived records: renewal of Arkiv evidence and published score checkpoints.
