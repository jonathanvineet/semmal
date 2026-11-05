"""Durable local incident spool: ordering, idempotency, stage rules, restart."""
import json

import pytest

from semmal_incident.manifest import UNSIGNED, canonical_json, manifest_hash
from semmal_incident.spool import (ARKIV_CONFIRMED, LOCAL_DURABLE, STORAGE_CONFIRMED,
                                   IncidentSpool, StageError)

SUMMARY = {'left_motor_current_a': 8.5, 'left_motor_temperature_c': 105.0, 'left_encoder_stale': False}


def rec(s, ev='ev-1', code='LEFT_MOTOR_OVERCURRENT'):
    return s.record(robot_id='robot-demo-001', source_event_id=ev, fault_code=code,
                    severity='critical', sensor_summary=SUMMARY, task_id='task-1', episode_id='ep-1')


def test_record_is_durable_sequenced_and_hash_chained(tmp_path):
    p = str(tmp_path / 'spool.db')
    s = IncidentSpool(p)
    a, ca = rec(s, 'ev-1')
    b, cb = rec(s, 'ev-2')
    assert ca and cb and a['stage'] == LOCAL_DURABLE
    assert (a['sequence_number'], b['sequence_number']) == (1, 2)
    ma, mb = json.loads(a['manifest_json']), json.loads(b['manifest_json'])
    assert ma['previous_event_hash'] is None and mb['previous_event_hash'] == ma['manifest_hash']
    assert ma['robot_signature'] == UNSIGNED and ma['safety_action'] == 'EMERGENCY_STOP'
    assert manifest_hash(ma) == ma['manifest_hash']
    s.close()
    # restart: data is still there, sequence continues
    s2 = IncidentSpool(p)
    assert [r['sequence_number'] for r in s2.all()] == [1, 2]
    c, _ = rec(s2, 'ev-3')
    assert c['sequence_number'] == 3


def test_duplicate_delivery_does_not_duplicate(tmp_path):
    s = IncidentSpool(str(tmp_path / 'spool.db'))
    a, created1 = rec(s, 'ev-1')
    b, created2 = rec(s, 'ev-1')
    assert created1 and not created2 and a['incident_id'] == b['incident_id']
    assert len(s.all()) == 1


def test_stage_order_enforced_and_acks_idempotent(tmp_path):
    s = IncidentSpool(str(tmp_path / 'spool.db'))
    a, _ = rec(s)
    iid = a['incident_id']
    with pytest.raises(StageError):
        s.mark_arkiv_confirmed(iid, '0xabc')         # Arkiv before Storage
    with pytest.raises(StageError):
        s.mark_storage_confirmed(iid, '')            # no root, no confirmation
    assert s.get(iid)['stage'] == LOCAL_DURABLE
    r = s.mark_storage_confirmed(iid, '0xroot')
    assert r['stage'] == STORAGE_CONFIRMED and r['storage_root'] == '0xroot'
    assert s.mark_storage_confirmed(iid, '0xroot')['stage'] == STORAGE_CONFIRMED  # duplicate ack
    # Arkiv fails: root retained, only Arkiv retried
    f = s.record_failure(iid, 'rpc down')
    assert f['stage'] == STORAGE_CONFIRMED and f['storage_root'] == '0xroot' and f['attempts'] == 1
    assert s.pending_summary()['pending_count'] == 1
    r = s.mark_arkiv_confirmed(iid, '0xentity')
    assert r['stage'] == ARKIV_CONFIRMED and r['attempts'] == 0
    assert s.pending_summary()['pending_count'] == 0


def test_backoff_is_bounded(tmp_path):
    import datetime as dt
    s = IncidentSpool(str(tmp_path / 'spool.db'))
    a, _ = rec(s)
    now = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)
    for _ in range(20):
        r = s.record_failure(a['incident_id'], 'x', now=now, base_s=2, max_s=300)
    assert r['next_attempt_at'] == '2026-01-01T00:05:00.000Z'


def test_canonical_json_rejects_nan():
    with pytest.raises(ValueError):
        canonical_json({'a': float('nan')})
    assert canonical_json({'b': 1, 'a': [1, 2]}) == '{"a":[1,2],"b":1}'
