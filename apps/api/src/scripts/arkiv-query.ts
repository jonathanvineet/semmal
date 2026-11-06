/**
 * Run a Semmal query against Arkiv (Rabdi testnet). No wallet needed; without ARKIV_ACCESS_KEY the SDK uses
 * Arkiv's public, rate-limited RPC.
 *
 *   pnpm arkiv:query                  scored jobs of every robot, best first
 *   pnpm arkiv:query rbt-103e832a38   one robot's scored jobs
 *
 * Runs: SELECT semmal_episode_v2 [WHERE robot_id = <id>] ORDER BY task_score DESC LIMIT 20
 * (ArkivRegistry.scoredEpisodes). Each row's $owner is the robot wallet that signed it.
 */
import { ArkivRegistry, arkivConfigFromEnv } from "@semmal/arkiv-adapter";

const rows = await new ArkivRegistry(arkivConfigFromEnv()).scoredEpisodes(process.argv[2]);
for (const e of rows) {
  console.log(`${e.task_id}  robot ${e.robot_id}  ${e.outcome}  task_score ${e.task_score}  owner ${e.$owner}  entity ${e.$key}`);
  for (const p of e.body?.score?.parts ?? []) console.log(`    ${String(p.label).padEnd(22)} ${p.judged ? `${p.points}/${p.max}` : "—"}  ${p.detail}`);
  for (const j of e.body?.agentJobs ?? []) console.log(`    agent ${j.agentId} job at ${j.at}: ${j.score}`);
}
console.log(`${rows.length} scored episode(s)`);
process.exit(0);
