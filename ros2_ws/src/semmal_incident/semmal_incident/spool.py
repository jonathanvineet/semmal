"""Durable local incident spool (SQLite, WAL, synchronous=FULL). No ROS, no network.

The incident row is committed BEFORE any remote write is attempted. Remote persistence stages
advance only on acknowledgement, strictly in order:
    LOCAL_DURABLE -> STORAGE_CONFIRMED (needs storage_root) -> ARKIV_CONFIRMED (needs entity key)
Idempotency: one row per idempotency_key (derived from the source fault event); re-delivery
returns the existing row. Sequence numbers are gap-free and strictly increasing per spool.
"""
import datetime as _dt
import hashlib
import json
import os
import sqlite3
import uuid

from .manifest import build_manifest

LOCAL_DURABLE = 'LOCAL_DURABLE'
STORAGE_CONFIRMED = 'STORAGE_CONFIRMED'
ARKIV_CONFIRMED = 'ARKIV_CONFIRMED'

SCHEMA = """
CREATE TABLE IF NOT EXISTS incidents (
  incident_id      TEXT PRIMARY KEY,
  idempotency_key  TEXT NOT NULL UNIQUE,
  sequence_number  INTEGER NOT NULL UNIQUE,
  robot_id         TEXT NOT NULL,
  fault_code       TEXT NOT NULL,
  severity         TEXT NOT NULL,
  detected_at      TEXT NOT NULL,
  manifest_json    TEXT NOT NULL,
  manifest_hash    TEXT NOT NULL,
  stage            TEXT NOT NULL DEFAULT 'LOCAL_DURABLE'
                   CHECK (stage IN ('LOCAL_DURABLE','STORAGE_CONFIRMED','ARKIV_CONFIRMED')),
  storage_root     TEXT,
  arkiv_entity_key TEXT,
  attempts         INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  TEXT,
  last_error       TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  CHECK (stage = 'LOCAL_DURABLE' OR storage_root IS NOT NULL),
  CHECK (stage <> 'ARKIV_CONFIRMED' OR arkiv_entity_key IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS incidents_stage ON incidents(stage, sequence_number);
"""


def utc_now():
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def idempotency_key(robot_id, source_event_id):
    return hashlib.sha256(f'{robot_id}|{source_event_id}'.encode()).hexdigest()


class StageError(RuntimeError):
    pass


class IncidentSpool:
    def __init__(self, path):
        d = os.path.dirname(os.path.abspath(path))
        os.makedirs(d, exist_ok=True)
        self.path = path
        self.db = sqlite3.connect(path, isolation_level=None, timeout=10.0)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.executescript(SCHEMA)

    def close(self):
        self.db.close()

    # ------------------------------------------------------------- recording
    def record(self, *, robot_id, source_event_id, fault_code, severity, sensor_summary,
               task_id=None, episode_id=None, safety_state=None, detected_at=None,
               firmware_version='simulated', software_version='0.1.0', inference_request_ids=None):
        """Durably record an incident. Returns (row_dict, created: bool)."""
        key = idempotency_key(robot_id, source_event_id)
        db = self.db
        db.execute('BEGIN IMMEDIATE')
        try:
            existing = db.execute('SELECT * FROM incidents WHERE idempotency_key=?', (key,)).fetchone()
            if existing is not None:
                db.execute('COMMIT')
                return dict(existing), False
            last = db.execute('SELECT sequence_number, manifest_hash FROM incidents '
                              'ORDER BY sequence_number DESC LIMIT 1').fetchone()
            seq = (last['sequence_number'] + 1) if last else 1
            prev = last['manifest_hash'] if last else None
            iid = str(uuid.uuid4())
            detected_at = detected_at or utc_now()
            m = build_manifest(incident_id=iid, robot_id=robot_id, task_id=task_id, episode_id=episode_id,
                               sequence_number=seq, fault_code=fault_code, severity=severity,
                               detected_at=detected_at, sensor_summary=sensor_summary,
                               previous_event_hash=prev, source_event_id=source_event_id,
                               firmware_version=firmware_version, software_version=software_version,
                               safety_state=safety_state, inference_request_ids=inference_request_ids)
            now = utc_now()
            db.execute('INSERT INTO incidents (incident_id, idempotency_key, sequence_number, robot_id, '
                       'fault_code, severity, detected_at, manifest_json, manifest_hash, created_at, updated_at) '
                       'VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                       (iid, key, seq, robot_id, fault_code, severity, detected_at,
                        json.dumps(m, sort_keys=True), m['manifest_hash'], now, now))
            db.execute('COMMIT')
        except BaseException:
            db.execute('ROLLBACK')
            raise
        return self.get(iid), True

    # ---------------------------------------------------------------- queries
    def get(self, incident_id):
        r = self.db.execute('SELECT * FROM incidents WHERE incident_id=?', (incident_id,)).fetchone()
        return dict(r) if r else None

    def all(self):
        return [dict(r) for r in self.db.execute('SELECT * FROM incidents ORDER BY sequence_number')]

    def pending(self):
        return [dict(r) for r in self.db.execute(
            "SELECT * FROM incidents WHERE stage <> 'ARKIV_CONFIRMED' ORDER BY sequence_number")]

    def pending_summary(self):
        r = self.db.execute("SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM incidents "
                            "WHERE stage <> 'ARKIV_CONFIRMED'").fetchone()
        return {'pending_count': r['n'], 'oldest_pending_created_at': r['oldest']}

    # ------------------------------------------------------- stage transitions
    def mark_storage_confirmed(self, incident_id, storage_root):
        if not storage_root:
            raise StageError('storage_root required')
        return self._advance(incident_id, LOCAL_DURABLE, STORAGE_CONFIRMED,
                             'storage_root=?', (storage_root,), idempotent_col=('storage_root', storage_root))

    def mark_arkiv_confirmed(self, incident_id, entity_key):
        if not entity_key:
            raise StageError('arkiv entity key required')
        return self._advance(incident_id, STORAGE_CONFIRMED, ARKIV_CONFIRMED,
                             'arkiv_entity_key=?', (entity_key,), idempotent_col=('arkiv_entity_key', entity_key))

    def _advance(self, incident_id, frm, to, set_sql, args, idempotent_col):
        db = self.db
        db.execute('BEGIN IMMEDIATE')
        try:
            r = db.execute('SELECT * FROM incidents WHERE incident_id=?', (incident_id,)).fetchone()
            if r is None:
                raise StageError(f'unknown incident {incident_id}')
            col, val = idempotent_col
            if r['stage'] == to and r[col] == val:
                db.execute('COMMIT')
                return dict(r)  # duplicate acknowledgement: no-op
            if r['stage'] != frm:
                raise StageError(f'{incident_id}: cannot go {r["stage"]} -> {to}')
            db.execute(f"UPDATE incidents SET stage=?, {set_sql}, attempts=0, next_attempt_at=NULL, "
                       f"last_error=NULL, updated_at=? WHERE incident_id=?", (to, *args, utc_now(), incident_id))
            db.execute('COMMIT')
        except BaseException:
            db.execute('ROLLBACK')
            raise
        return self.get(incident_id)

    def record_failure(self, incident_id, error, now=None, base_s=2.0, max_s=300.0):
        """Bounded exponential backoff for the next remote attempt of the current stage."""
        now = now or _dt.datetime.now(_dt.timezone.utc)
        r = self.get(incident_id)
        if r is None:
            raise StageError(f'unknown incident {incident_id}')
        attempts = r['attempts'] + 1
        delay = min(max_s, base_s * (2 ** (attempts - 1)))
        nxt = (now + _dt.timedelta(seconds=delay)).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        self.db.execute('UPDATE incidents SET attempts=?, next_attempt_at=?, last_error=?, updated_at=? '
                        'WHERE incident_id=?', (attempts, nxt, str(error)[:500], utc_now(), incident_id))
        return self.get(incident_id)
