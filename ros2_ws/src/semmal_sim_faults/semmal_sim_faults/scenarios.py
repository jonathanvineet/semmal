"""Scenario loading/validation for the simulation fault injector. No ROS."""
import glob
import os

import yaml

VALID_MOTORS = ('left', 'right')
VALID_ENCODER = ('normal', 'stale')
VALID_TRIGGERS = ('immediate',)
MAX_DURATION_MS = 60000


def simulation_allowed(env=None):
    """Fault injection is allowed only with APP_MODE=simulation and not explicitly disabled."""
    env = os.environ if env is None else env
    return (env.get('APP_MODE') == 'simulation'
            and env.get('SIM_FAULT_INJECTION_ENABLED', 'true').lower() != 'false')


class ScenarioError(ValueError):
    pass


def validate(d):
    if not isinstance(d, dict):
        raise ScenarioError('scenario must be a mapping')
    sid = d.get('scenario_id')
    if not isinstance(sid, str) or not sid:
        raise ScenarioError('scenario_id required')
    if d.get('trigger', 'immediate') not in VALID_TRIGGERS:
        raise ScenarioError(f'{sid}: unsupported trigger {d.get("trigger")!r}')
    f = d.get('fault')
    if not isinstance(f, dict):
        raise ScenarioError(f'{sid}: fault mapping required')
    if f.get('motor') not in VALID_MOTORS:
        raise ScenarioError(f'{sid}: fault.motor must be one of {VALID_MOTORS}')
    enc = f.get('encoder_state', 'normal')
    if enc not in VALID_ENCODER:
        raise ScenarioError(f'{sid}: fault.encoder_state must be one of {VALID_ENCODER}')
    for k in ('current_a', 'temperature_c'):
        if k in f and not isinstance(f[k], (int, float)):
            raise ScenarioError(f'{sid}: fault.{k} must be a number')
    dur = d.get('duration_ms')
    if not isinstance(dur, int) or not 0 < dur <= MAX_DURATION_MS:
        raise ScenarioError(f'{sid}: duration_ms must be an int in (0, {MAX_DURATION_MS}]')
    if 'current_a' not in f and 'temperature_c' not in f and enc == 'normal':
        raise ScenarioError(f'{sid}: scenario changes nothing')
    return {
        'scenario_id': sid, 'motor': f['motor'], 'duration_ms': dur,
        'current_a': float(f['current_a']) if 'current_a' in f else None,
        'temperature_c': float(f['temperature_c']) if 'temperature_c' in f else None,
        'encoder_stale': enc == 'stale',
    }


def load_dir(path):
    out = {}
    for p in sorted(glob.glob(os.path.join(path, '*.yaml'))):
        with open(p, 'r', encoding='utf-8') as fh:
            s = validate(yaml.safe_load(fh))
        if s['scenario_id'] in out:
            raise ScenarioError(f'duplicate scenario_id {s["scenario_id"]}')
        out[s['scenario_id']] = s
    return out
