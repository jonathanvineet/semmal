/**
 * Automatic, robot-signed evidence (CLAUDE.md 8.4, 8.5, 9). No person decides what is written.
 *
 *  LOCAL_DURABLE -> (sign + upload to 0G Storage) -> STORAGE_CONFIRMED (root) -> (Arkiv index) -> ARKIV_CONFIRMED
 *
 * - Episodes: kept in this service's outbox (robot-master.db) before any remote call.
 * - Incidents: read from the ROS incident spool (semmal_incident, SQLite) and advanced with the same
 *   stage rules the spool enforces (only forward, root before Arkiv).
 * - Retries back off (2 s .. 5 min). Before every Arkiv attempt the record is looked up on Arkiv
 *   first, so a retry after an uncertain submission never creates a duplicate.
 * - Bundles carry IDs, timings, decisions with 0G request IDs, transitions and diagnostics.
 *   No images, no customer data. Plain (not encrypted) so anyone can verify them against the root.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { eq } from "@arkiv-network/sdk/query";
import { EpisodeSchema, IncidentSchema, episodeCreateArgs, incidentCreateArgs, jobClaimCreateArgs, quoteCreateArgs } from "@semmal/arkiv-adapter";
import type { JobClaim, TaskQuote } from "@semmal/contracts";
import type { Device } from "./device";
import type { EpisodeRecord, EvidenceSink } from "./mission";

export const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const backoff = (attempts: number) => Math.min(300_000, 2_000 * 2 ** Math.max(0, attempts - 1));

type Log = (msg: string) => void;
type Notify = (kind: "incident" | "episode", id: string, stage: string, extra?: Record<string, string>) => void;

export class Evidence implements EvidenceSink {
  private db: DatabaseSync;
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(
    private device: Device,
    private robotId: string,
    dataDir: string,
    private spoolPath: string,
    private log: Log,
    private notify: Notify,
  ) {
    this.db = new DatabaseSync(`${dataDir}/robot-master.db`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT 'LOCAL_DURABLE' CHECK (stage IN ('LOCAL_DURABLE','STORAGE_CONFIRMED','ARKIV_CONFIRMED')),
      bundle TEXT, manifest_hash TEXT, signature TEXT, storage_root TEXT, entity_key TEXT,
      attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0, last_error TEXT,
      CHECK (stage = 'LOCAL_DURABLE' OR storage_root IS NOT NULL),
      CHECK (stage <> 'ARKIV_CONFIRMED' OR entity_key IS NOT NULL))`);
  }

  start(everyMs = 5000) {
    this.timer = setInterval(() => void this.tick(), everyMs);
    void this.tick();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------------------------------------------------------------- coordination (time-bound)
  async quote(q: TaskQuote) {
    const r = await this.device.arkivCreate(`quote:${q.quoteId}`, quoteCreateArgs(q));
    this.log(`quote ${q.quoteId} on Arkiv (${r.entityKey.slice(0, 10)}…)`);
  }
  async claim(c: JobClaim) {
    const r = await this.device.arkivCreate(`claim:${c.jobId}`, jobClaimCreateArgs(c));
    this.log(`job claim ${c.jobId} → ${c.agentId} on Arkiv (${r.entityKey.slice(0, 10)}…)`);
  }

  // ---------------------------------------------------------------- episodes
  async episode(e: EpisodeRecord) {
    this.db.prepare("INSERT OR IGNORE INTO outbox (id, kind, payload) VALUES (?, 'episode', ?)").run(e.episodeId, JSON.stringify(e));
    this.notify("episode", e.episodeId, "LOCAL_DURABLE");
    void this.tick();
  }

  pending() {
    const out = this.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE stage <> 'ARKIV_CONFIRMED'").get() as { n: number };
    return out.n;
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const rows = this.db.prepare("SELECT * FROM outbox WHERE stage <> 'ARKIV_CONFIRMED' AND next_at <= ? ORDER BY rowid LIMIT 5").all(Date.now()) as Record<string, string | number | null>[];
      for (const r of rows) await this.advanceEpisode(r);
      await this.incidents();
    } finally {
      this.busy = false;
    }
  }

  private fail(id: string, attempts: number, err: unknown) {
    this.db.prepare("UPDATE outbox SET attempts = ?, next_at = ?, last_error = ? WHERE id = ?").run(attempts + 1, Date.now() + backoff(attempts + 1), String((err as Error)?.message ?? err).slice(0, 300), id);
  }

  private async advanceEpisode(r: Record<string, string | number | null>) {
    const id = String(r.id);
    const attempts = Number(r.attempts);
    const e = JSON.parse(String(r.payload)) as EpisodeRecord;
    try {
      if (r.stage === "LOCAL_DURABLE") {
        const body = { schema: "semmal-episode-bundle-v1", robot_wallet: this.device.address, ...e };
        const hash = `sha256:${sha(canonical(body))}`;
        const signature = await this.device.signManifestHash(hash);
        const bundle = canonical({ ...body, manifest_hash: hash, robot_signature: signature });
        const up = await this.device.storageUpload(new TextEncoder().encode(bundle));
        this.db.prepare("UPDATE outbox SET stage = 'STORAGE_CONFIRMED', bundle = ?, manifest_hash = ?, signature = ?, storage_root = ?, attempts = 0, next_at = 0, last_error = NULL WHERE id = ? AND stage = 'LOCAL_DURABLE'").run(bundle, hash, signature, up.rootHash, id);
        this.notify("episode", id, "STORAGE_CONFIRMED", { root: up.rootHash });
        Object.assign(r, { stage: "STORAGE_CONFIRMED", manifest_hash: hash, signature, storage_root: up.rootHash });
      }
      if (r.stage === "STORAGE_CONFIRMED") {
        const existing = await this.findOnArkiv(EpisodeSchema, "episode_id", id);
        const key =
          existing ??
          (
            await this.device.arkivCreate(`episode:${id}`, episodeCreateArgs({
              schemaVersion: "1.0", episodeId: id, taskId: e.taskId, robotId: this.robotId, robotWallet: this.device.address,
              outcome: e.outcome, startedAt: e.startedAt, endedAt: e.endedAt, storageRoot: String(r.storage_root) as `0x${string}`,
              manifestHash: `0x${String(r.manifest_hash).replace("sha256:", "")}`, robotSignature: String(r.signature),
              requestIds: e.decisions.map((x) => x.providerRequestId).filter((x): x is string => Boolean(x)).slice(0, 50),
              agents: e.hired.slice(0, 10), seqFrom: 0, seqTo: e.transitions.length,
            }))
          ).entityKey;
        this.db.prepare("UPDATE outbox SET stage = 'ARKIV_CONFIRMED', entity_key = ?, attempts = 0, last_error = NULL WHERE id = ? AND stage = 'STORAGE_CONFIRMED'").run(key, id);
        this.notify("episode", id, "ARKIV_CONFIRMED", { entityKey: key });
        this.log(`episode ${id} confirmed: root ${String(r.storage_root).slice(0, 12)}…, Arkiv ${key.slice(0, 10)}…`);
      }
    } catch (err) {
      this.fail(id, attempts, err);
      this.log(`episode ${id}: ${(err as Error).message} (will retry)`);
    }
  }

  /** The record's entity key if this robot already wrote it (idempotent retries). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async findOnArkiv(schema: any, col: string, id: string): Promise<string | null> {
    const page = await this.device.arkiv.select({ $key: true, $owner: true }).from(schema).where(eq(col, id)).limit(10).fetch();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mine = page.entities.find((x: any) => String(x.$owner).toLowerCase() === this.device.address.toLowerCase());
    return mine ? String((mine as { $key: string }).$key) : null;
  }

  // ---------------------------------------------------------------- incidents (ROS spool)
  private async incidents() {
    if (!existsSync(this.spoolPath)) return;
    const spool = new DatabaseSync(this.spoolPath);
    try {
      spool.exec("PRAGMA busy_timeout = 5000");
      const now = new Date().toISOString();
      const rows = spool.prepare("SELECT * FROM incidents WHERE stage <> 'ARKIV_CONFIRMED' AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY sequence_number LIMIT 5").all(now) as Record<string, string | number | null>[];
      for (const r of rows) {
        const id = String(r.incident_id);
        try {
          const manifest = JSON.parse(String(r.manifest_json));
          if (r.stage === "LOCAL_DURABLE") {
            const signature = await this.device.signManifestHash(String(r.manifest_hash));
            const bundle = canonical({ schema: "semmal-incident-bundle-v1", robot_wallet: this.device.address, manifest: { ...manifest, robot_signature: signature } });
            const up = await this.device.storageUpload(new TextEncoder().encode(bundle));
            spool.prepare("UPDATE incidents SET stage = 'STORAGE_CONFIRMED', storage_root = ?, attempts = 0, next_attempt_at = NULL, last_error = NULL, updated_at = ? WHERE incident_id = ? AND stage = 'LOCAL_DURABLE'").run(up.rootHash, new Date().toISOString(), id);
            this.notify("incident", id, "STORAGE_CONFIRMED", { root: up.rootHash, faultCode: String(r.fault_code), severity: String(r.severity) });
            Object.assign(r, { stage: "STORAGE_CONFIRMED", storage_root: up.rootHash, signature });
          }
          if (r.stage === "STORAGE_CONFIRMED") {
            const signature = (r as { signature?: string }).signature ?? (await this.device.signManifestHash(String(r.manifest_hash)));
            const key =
              (await this.findOnArkiv(IncidentSchema, "incident_id", id)) ??
              (
                await this.device.arkivCreate(`incident:${id}`, incidentCreateArgs({
                  schemaVersion: "1.0", incidentId: id, robotId: this.robotId, robotWallet: this.device.address,
                  taskId: manifest.task_id ?? undefined, episodeId: manifest.episode_id ?? undefined, faultCode: String(r.fault_code),
                  severity: String(r.severity) as "critical", safetyAction: manifest.safety_action ?? "EMERGENCY_STOP", detectedAt: String(r.detected_at),
                  sequence: Number(r.sequence_number), storageRoot: String(r.storage_root) as `0x${string}`,
                  manifestHash: `0x${String(r.manifest_hash).replace("sha256:", "")}`, robotSignature: signature,
                  requestIds: (manifest.inference_request_ids ?? []).slice(0, 20),
                }))
              ).entityKey;
            spool.prepare("UPDATE incidents SET stage = 'ARKIV_CONFIRMED', arkiv_entity_key = ?, attempts = 0, last_error = NULL, updated_at = ? WHERE incident_id = ? AND stage = 'STORAGE_CONFIRMED'").run(key, new Date().toISOString(), id);
            this.notify("incident", id, "ARKIV_CONFIRMED", { entityKey: key, faultCode: String(r.fault_code), severity: String(r.severity) });
            this.log(`incident ${id} (${r.fault_code}) confirmed on 0G Storage and Arkiv`);
          }
        } catch (err) {
          const attempts = Number(r.attempts) + 1;
          spool.prepare("UPDATE incidents SET attempts = ?, next_attempt_at = ?, last_error = ?, updated_at = ? WHERE incident_id = ?").run(attempts, new Date(Date.now() + backoff(attempts)).toISOString(), String((err as Error).message).slice(0, 300), new Date().toISOString(), id);
          this.log(`incident ${id}: ${(err as Error).message} (will retry)`);
        }
      }
    } finally {
      spool.close();
    }
  }
}
