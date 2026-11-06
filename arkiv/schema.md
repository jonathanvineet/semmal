# Arkiv schema: Semmal (செம்மல்)

Network: **Rabdi** (Arkiv DB-Chain testnet, chain ID 7794095), `@arkiv-network/sdk` 1.0.1.
Schemas are defined once in [`packages/arkiv-adapter/src/schemas.ts`](../packages/arkiv-adapter/src/schemas.ts) and
encoded in [`encode.ts`](../packages/arkiv-adapter/src/encode.ts). Only columns we filter or sort on are indexed; the
full, validated document (zod contracts in [`packages/contracts`](../packages/contracts/src/index.ts)) is in a `bytes()`
column.

**Who can write.** Nobody holds a key for someone else. People sign in their own browser wallet (EIP-1193) after an
in-app approval card showing gas and maximum fee. The only key in the system is each robot's own device key, created on
the robot PC; it can write only the four robot-evidence schemas and only under a daily fee cap
([`services/robot-master/src/device.ts`](../services/robot-master/src/device.ts), `ALLOWED_SCHEMAS`).
**Readers check ownership:** a record counts only when its Arkiv `$owner` and `$creator` equal the wallet named inside
it, and robot-signed records only when that wallet is the robot wallet on the robot's registered profile
([`registry.ts`](../packages/arkiv-adapter/src/registry.ts), `toEntries`, `robotSigned`).

| Entity (schema name) | Written by = `$owner` | Expires | Indexed (queryable) columns | Body |
|---|---|---|---|---|
| Robot profile `semmal_robot_profile_v2` | robot owner's wallet | 90 days; renewed by publishing a new `profile_version` | `robot_id`, `robot_wallet`, `owner_wallet`, `model`, `robot_type`, `service_area`, `can_inspect`, `can_patrol`, `can_deliver`, `skill_1..4`, `price`, `profile_version` | profile incl. pricing policy, coarse base (~1 km), the robot's signed identity |
| Agent listing `semmal_agent_profile_v2` | agent owner's wallet | 90 days; renewed by re-publishing | `agent_id`, `owner_wallet`, `kind`, `primary_capability`, `trust_mode`, `price` | listing incl. 0G model + trust mode, price per job |
| Booking `semmal_task_request_v1` | customer's wallet | at the booking's deadline | `task_id`, `robot_id`, `skill`, `area`, `customer`, `max_budget` | plan, delivery date (never the address) |
| Quote `semmal_quote_v1` | robot wallet (device key) | at the offer's `validUntil` | `quote_id`, `task_id`, `robot_id`, `amount` | priced lines, robot signature |
| Job claim `semmal_job_claim_v1` | robot wallet | at the agent job's deadline | `job_id`, `task_id`, `robot_id`, `agent_id` | price, deadline |
| Episode `semmal_episode_v2` (v1 for older jobs) | robot wallet | 120 days | `episode_id`, `task_id`, `robot_id`, `outcome`, **`task_score`** (v2), `storage_root`, `ended_at` | 0G Storage root, manifest hash, robot signature, 0G request IDs, hired agents, **job score breakdown**, **agent job scores** |
| Incident `semmal_incident_v1` | robot wallet | 120 days | `incident_id`, `robot_id`, `fault_code`, `severity`, `storage_root`, `sequence` | fault, safety action, 0G Storage root, signature |
| Reputation `semmal_reputation_v1` | instance owner's wallet | 120 days; refreshed by publishing again | `subject_kind`, `subject_id`, `score`, `status` | formula (score-v2), counts, publisher |

**What we filter on** (each is a query the app runs):

| Query | Where users see it |
|---|---|
| `robot_profile_v2` all / `WHERE robot_wallet = ?` / `WHERE owner_wallet = ?` | booking map + robot list, wallet-taken check at registration, owner dashboard |
| `agent_profile_v2` `ORDER BY price DESC` (by `kind` for the market filter) | Agent market, robots' hiring, quotes |
| `task_request_v1 WHERE customer = ?` / `WHERE robot_id = ?` / `WHERE task_id = ?` | Your orders, owner's booking requests, every booking view |
| `quote_v1 WHERE task_id = ?`, `job_claim_v1 WHERE task_id = ?` | the robot's offer, which agents it hired |
| `episode_v2 WHERE robot_id = ?` (+ v1), `WHERE task_id = ?`, `ORDER BY task_score DESC` | evidence log, "What went to Arkiv", scores, `pnpm arkiv:query` |
| `incident_v1 WHERE robot_id = ?` | evidence log, robot scores |
| `reputation_v1` all | published scores in the dashboard |

**Why these lifetimes.** Coordination state (bookings, quotes, job claims) is only useful until its deadline, so it
expires exactly then: nobody has to clean up a stale offer. Registrations last about 3 months, so a robot or agent that
stops being maintained (or is excluded by its score) simply lapses. Evidence and scores last about 4 months (Rabdi's
maximum is about 6), long enough to score a robot on its recent work; the full bundles stay on 0G Storage.

**Live now** (read from Arkiv at block 305,293, 2026-11-07): 2 robot profiles, 2 agent listings, 5 bookings, 5 quotes,
1 job claim, 6 + 1 episodes (v1 + v2), 21 incidents, 0 reputation checkpoints.
