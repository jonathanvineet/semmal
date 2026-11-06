# Why Arkiv

## If we swapped Arkiv for Postgres, what would users lose?

Semmal has four parties who do not trust each other: customers, robot owners, the robots themselves, and the people
who sell AI agents. With a Postgres database, all four would have to trust whoever runs it. With Arkiv:

1. **A robot's record can't be edited by the platform or by its owner.** Episodes, incidents, quotes and job claims
   are owned by the robot's own wallet, a key generated on the robot PC that never leaves it. In Postgres the operator
   could delete a failed job, change a score or hide an incident. Customers would lose the reason to believe a robot's
   score, and the score is what ranks robots for booking.
2. **Anyone can recompute every score.** Job scores, agent job scores and the inputs behind each are in robot-signed
   entities that anyone can query (`pnpm arkiv:query`). A score in Postgres would be just the operator's word.
3. **The registry isn't ours to gatekeep.** Any owner publishes a robot, and any developer publishes an agent with its
   price and trust mode, from their own wallet. Other apps can read the same listings. In Postgres the operator decides
   who is listed and can quietly change someone's price.
4. **Stale coordination state cleans itself up.** Bookings, quotes and job claims expire at their own deadline. In
   Postgres we would need a cron job and trust that it ran.
5. **Ownership is the permission system.** "Only the customer can change a booking" and "only the robot can write its
   evidence" are enforced by Arkiv's `$owner` plus our readers' checks, not by code a user cannot see.

What Arkiv gives users in one sentence: **you can check a robot's record without trusting us.**

## What we kept off Arkiv, and why

| Kept off Arkiv | Where it lives | Why |
|---|---|---|
| Live position, battery, heartbeat, availability | API memory + robot gateway (WebSocket) | changes every second; public history of where a robot is would be a privacy and safety problem |
| The customer's exact address | the booking message to the robot only | only the robot needs it; Arkiv keeps the area name and the robot's base to ~1 km |
| Camera frames | nowhere: sent once to the private 0G model, never stored | privacy; the record keeps the request ID and input hash instead |
| Full episode bundles (every state change, purchase, decision, receipt) | **0G Storage**, root and manifest hash on Arkiv | large; Arkiv holds the queryable index and the signed hash, Storage the content |
| Notifications, sign-in sessions | API (SQLite / memory) | per-user, private, short-lived |
| Payments | native 0G on 0G Galileo | the money chain; Arkiv stores the job, the robot's ledger cites the 0G tx hashes |
| API keys, the robot's device key | robot PC / server env only | secrets |
