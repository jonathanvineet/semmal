# How Semmal uses Arkiv

Semmal is a robot-for-hire marketplace where **every robot is its own agent**: it is booked by a customer, prices the
job itself, hires AI agents from a public registry, pays them in 0G, does the job, and signs its own record. Arkiv is
the shared database all of these parties read and write without trusting the platform.

## Do the filters, edit rights and expiry fit the app?

**Filters.** Each indexed column exists because a screen or a robot filters on it (full list: [schema.md](schema.md)):
a customer's orders (`customer`), an owner's robots (`owner_wallet`), a robot's evidence (`robot_id`), one booking's
offer and hires (`task_id`), the agent market by kind and price, and jobs ranked by score (`task_score`). Everything
else (pricing policy, location to ~1 km, score breakdowns) is in the validated `bytes()` body, never indexed.

**Who can edit.** Each entity is owned by the party that is accountable for it, and readers enforce it:

| Entity | Owner | Why that owner |
|---|---|---|
| Robot profile, agent listing | its owner's wallet | only the owner may change prices or capabilities |
| Booking | the customer's wallet | only the customer books and pays |
| Quote, job claim, episode, incident | **the robot's own wallet** (device key on the robot PC) | the robot answers for its price, its hires and its work; no person, including its owner, can alter or withhold its record |
| Reputation checkpoint | the instance owner | a published, dated statement anyone can recompute from the episodes |

A record whose `$owner`/`$creator` does not match the wallet inside it is ignored, and a robot record counts only if the
robot wallet is the one on its registered profile. So a robot cannot be impersonated by writing in its name.

**Expiry.** Bookings, quotes and job claims expire at their own deadline (`ExpirationTime` computed from the
deadline); registrations after 90 days; evidence and scores after 120 days. See [schema.md](schema.md).

## Each Arkiv feature changes something users see

| Arkiv feature | What the user sees |
|---|---|
| Queryable registry (robot profiles) | the booking map and the robot list near your site; "this wallet is already registered" at registration |
| Queryable registry (agent listings) | the Agent market, its kind filter and prices; the agents a robot can hire |
| Owner-signed bookings with deadline expiry | "Your orders"; the owner's "requests waiting for you"; an expired booking disappears by itself |
| Robot-signed quotes | the robot's price on the booking, payable in 0G |
| Robot-signed episodes with `task_score` | the evidence log, **"What went to Arkiv"** (the entity read back: schema, indexed columns, stored body, owner, expiry, explorer link), the job score and how it was calculated |
| Ownership checks | records not signed by the right wallet never appear |
| Scores built from episodes | which robot is ranked first when you book, and which agent a robot hires (selection score) |
| Explorer links (`/entity/`, `/address/`, `/tx/`) | every record links to the Rabdi explorer |

## Numbers

Read from Arkiv on 2026-11-07 (block 305,293): 2 robot profiles, 2 agent listings, 5 bookings, 5 robot quotes,
1 job claim, 7 episodes (1 with a job score), 21 incidents. The scored episode:
[`0x51c9…ac9e`](https://rabdi.explorer.arkiv.network/entity/0x51c9c22cdb1b9c1baceac036c3b044f70571dcb564c52363343de8a695c2ac9e),
`task_score` 100, written by robot wallet `0x103E832a3801684eDEE9b82057F7a72Cb23629BC`.

## Run a query

```bash
pnpm install
pnpm arkiv:query                  # SELECT semmal_episode_v2 ORDER BY task_score DESC LIMIT 20
pnpm arkiv:query rbt-103e832a38   # ... WHERE robot_id = 'rbt-103e832a38'
```

No key is needed (the SDK uses Arkiv's public, rate-limited RPC); set `ARKIV_ACCESS_KEY` for a higher limit.
Code: [`ArkivRegistry.scoredEpisodes`](../packages/arkiv-adapter/src/registry.ts).
