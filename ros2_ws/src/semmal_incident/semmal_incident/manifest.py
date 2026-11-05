"""Canonical incident manifest (schema 1.0). No ROS.

Canonical serialisation ("semmal-canonical-json-v1"): UTF-8 JSON, keys sorted, no whitespace,
no NaN/Infinity. The manifest hash is SHA-256 over the canonical form with `manifest_hash` and
`robot_signature` removed. The signature is made later by the owner's wallet over that hash
(EIP-191); until then it is the literal placeholder below and must never be shown as real.
"""
import hashlib
import json
import math

SCHEMA_VERSION = '1.0'
UNSIGNED = 'SIMULATED_SIGNATURE'
CANONICALISATION = 'semmal-canonical-json-v1'
UNHASHED_FIELDS = ('manifest_hash', 'robot_signature')
SAFETY_ACTION_FOR_SEVERITY = {'critical': 'EMERGENCY_STOP', 'warning': 'DEGRADED_SPEED', 'info': 'NONE'}


def canonical_json(obj) -> str:
    def check(o):
        if isinstance(o, float) and not math.isfinite(o):
            raise ValueError('non-finite float in manifest')
        if isinstance(o, dict):
            for v in o.values():
                check(v)
        elif isinstance(o, (list, tuple)):
            for v in o:
                check(v)
    check(obj)
    return json.dumps(obj, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)


def manifest_hash(manifest: dict) -> str:
    body = {k: v for k, v in manifest.items() if k not in UNHASHED_FIELDS}
    return 'sha256:' + hashlib.sha256(canonical_json(body).encode('utf-8')).hexdigest()


def build_manifest(*, incident_id, robot_id, task_id, episode_id, sequence_number, fault_code, severity,
                   detected_at, sensor_summary, previous_event_hash, source_event_id,
                   firmware_version='simulated', software_version='0.1.0', safety_state=None,
                   inference_request_ids=None):
    m = {
        'schema_version': SCHEMA_VERSION,
        'canonicalisation': CANONICALISATION,
        'incident_id': incident_id,
        'robot_id': robot_id,
        'task_id': task_id,
        'episode_id': episode_id,
        'sequence_number': int(sequence_number),
        'fault_code': fault_code,
        'severity': severity,
        'detected_at': detected_at,
        'safety_action': SAFETY_ACTION_FOR_SEVERITY.get(severity, 'NONE'),
        'safety_state_at_record': safety_state,
        'sensor_summary': {k: (round(v, 3) if isinstance(v, float) else v) for k, v in sensor_summary.items()},
        'firmware_version': firmware_version,
        'software_version': software_version,
        'source_event_id': source_event_id,
        'inference_request_ids': list(inference_request_ids or []),
        'previous_event_hash': previous_event_hash,
    }
    m['manifest_hash'] = manifest_hash(m)
    m['robot_signature'] = UNSIGNED
    return m
