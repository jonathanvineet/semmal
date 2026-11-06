"""Pure logic for the robot-host gateway. No ROS imports, testable anywhere.

- keyframes: decode the mission executor's binary PPM (P6), shrink it, encode PNG with zlib only
- zone: a coarse place name (nearest named waypoint), never coordinates
- availability: what the platform may know about whether the robot can take work
- path safety: only files inside the keyframe directory can be read
- clearing: which props a clearing step may move, and where to (allowlisted per world, per stop)
"""
import base64
import json
import math
import os
import struct
import tempfile
import zlib

MOTION_OK = ('NORMAL', 'DEGRADED')


def read_ppm(path):
    """Return (width, height, rgb bytes) of a binary P6 PPM with maxval 255."""
    with open(path, 'rb') as f:
        data = f.read()
    tokens, i = [], 0
    while len(tokens) < 4:
        while i < len(data) and data[i:i + 1].isspace():
            i += 1
        if data[i:i + 1] == b'#':
            while i < len(data) and data[i:i + 1] not in (b'\n', b'\r'):
                i += 1
            continue
        j = i
        while j < len(data) and not data[j:j + 1].isspace():
            j += 1
        tokens.append(data[i:j])
        i = j
    if tokens[0] != b'P6' or int(tokens[3]) != 255:
        raise ValueError('not a P6 PPM with maxval 255')
    w, h = int(tokens[1]), int(tokens[2])
    pixels = data[i + 1: i + 1 + w * h * 3]
    if len(pixels) != w * h * 3:
        raise ValueError('truncated PPM')
    return w, h, pixels


def downscale(w, h, rgb, max_side):
    """Nearest-neighbour shrink so the long side is at most max_side. Returns (w, h, rgb)."""
    scale = min(1.0, max_side / max(w, h))
    if scale >= 1.0:
        return w, h, rgb
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    out = bytearray(nw * nh * 3)
    for y in range(nh):
        sy = min(h - 1, int(y / scale))
        row = sy * w * 3
        for x in range(nw):
            sx = min(w - 1, int(x / scale))
            s = row + sx * 3
            d = (y * nw + x) * 3
            out[d:d + 3] = rgb[s:s + 3]
    return nw, nh, bytes(out)


def encode_png(w, h, rgb):
    def chunk(tag, body):
        return struct.pack('>I', len(body)) + tag + body + struct.pack('>I', zlib.crc32(tag + body) & 0xffffffff)
    raw = b''.join(b'\x00' + rgb[y * w * 3:(y + 1) * w * 3] for y in range(h))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b''))


def keyframe_data_url(path, max_side=512):
    w, h, rgb = read_ppm(path)
    w, h, rgb = downscale(w, h, rgb, max_side)
    return {'dataUrl': 'data:image/png;base64,' + base64.b64encode(encode_png(w, h, rgb)).decode('ascii'), 'width': w, 'height': h}


def safe_keyframe_path(path, root):
    """Resolve and return the path only if it is a .ppm file inside root."""
    real_root = os.path.realpath(root)
    real = os.path.realpath(path)
    if not real.startswith(real_root + os.sep) or not real.endswith('.ppm') or not os.path.isfile(real):
        return None
    return real


def zone_for(x, y, waypoints, radius=2.5):
    best, best_d = None, math.inf
    for name, p in (waypoints or {}).items():
        d = math.hypot(x - float(p['x']), y - float(p['y']))
        if d < best_d:
            best, best_d = name, d
    return best if best is not None and best_d <= radius else 'in_transit'


def availability(safety_state, mission_phase, sensors_ready=True):
    if not sensors_ready:
        return 'offline'
    if safety_state not in MOTION_OK:
        return 'busy'
    if mission_phase and mission_phase not in ('IDLE', 'COMPLETED', 'CANCELED', 'FAILED', 'REJECTED', 'ABORTED_SAFETY'):
        return 'busy'
    return 'available'


def clearing_summary(clearing):
    """What the robot master needs to plan a clearing: per stop, where to go and what kind of job it is."""
    out = {}
    for stop, spot in sorted((clearing or {}).items()):
        items, marks = spot.get('items') or [], spot.get('wipe') or []
        out[stop] = {'approach': spot.get('approach'), 'dropAt': spot.get('drop_at') if items else None,
                     'pick': [i['name'] for i in items], 'wipe': [m['name'] for m in marks]}
    return out


def state_doc(*, safety_state, battery_pct, x, y, waypoints, mission_phase, task_id, executor_ready, hold, world=None, clearing=None):
    return {
        'world': world,
        'clearing': clearing_summary(clearing),
        'waypoints': sorted((waypoints or {}).keys()),
        'safetyState': safety_state or 'DEGRADED',
        'batteryPct': max(0.0, min(100.0, float(battery_pct if battery_pct is not None else 0.0))),
        'zone': zone_for(x, y, waypoints) if x is not None else 'unknown',
        'availability': availability(safety_state, mission_phase, sensors_ready=safety_state is not None),
        'executor': bool(executor_ready),
        'missionPhase': mission_phase or 'IDLE',
        'activeTask': task_id,
        'hold': bool(hold),
    }


def write_atomic(path, doc):
    d = os.path.dirname(os.path.abspath(path)) or '.'
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, prefix='.state-')
    with os.fdopen(fd, 'w') as f:
        json.dump(doc, f)
    os.replace(tmp, path)


def validate_mission(body, allowed):
    """Return (goal dict, error). Waypoints must be allowlisted names."""
    if not isinstance(body, dict):
        return None, 'body must be an object'
    wps = body.get('waypoints')
    if not isinstance(wps, list) or not 1 <= len(wps) <= 10 or not all(isinstance(w, str) for w in wps):
        return None, 'waypoints must be 1-10 names'
    unknown = [w for w in wps if w not in allowed]
    if unknown:
        return None, f'not in the waypoint allowlist: {unknown}'
    try:
        speed = float(body.get('maxSpeed', 0) or 0)
        dwell = float(body.get('dwellS', 0) or 0)
    except (TypeError, ValueError):
        return None, 'maxSpeed and dwellS must be numbers'
    task_id = str(body.get('taskId', ''))[:64]
    if not task_id:
        return None, 'taskId required'
    return {
        'task_id': task_id,
        'episode_id': str(body.get('episodeId', ''))[:64],
        'waypoints': wps,
        'max_speed': max(0.0, min(speed, 0.4)),
        'dwell_s': max(0.0, min(dwell, 60.0)),
        'capture_keyframe': bool(body.get('captureKeyframe', False)),
    }, None


# ---------------------------------------------------------------- clearing
CLEAR_STEPS = ('reset', 'pick', 'drop', 'wipe')
REACH_M = 1.0            # the robot must be this close to the spot to pick up or wipe
STASH_Z = -2.0           # a picked-up item rides with the robot: it leaves the floor until it is dropped


def _pose(p):
    return {'x': float(p['x']), 'y': float(p['y']), 'z': float(p.get('z', 0.0))}


def clear_plan(clearing, waypoints, stop, step, robot_xy):
    """Return (list of {name, pose}, error) for one clearing step at one stop.

    Only props named in the world's `clearing` config can move, only to the places it names:
      reset  every listed prop back where the world put it (start of a job; any robot position)
      pick   the stop's items leave the floor (the robot must be at the stop's `approach` waypoint)
      drop   the picked items go into the bin (the robot must be at the stop's `drop_at` waypoint)
      wipe   the stop's spill marks are removed (the robot must be at the `approach` waypoint)
    """
    if step not in CLEAR_STEPS:
        return None, f'step must be one of {CLEAR_STEPS}'
    clearing = clearing or {}
    if step == 'reset':
        moves = []
        for spot in clearing.values():
            for it in (spot.get('items') or []) + (spot.get('wipe') or []):
                moves.append({'name': it['name'], 'pose': _pose(it)})
        return moves, None
    spot = clearing.get(stop)
    if spot is None:
        return None, f'nothing to clear at {stop!r} in this world'
    at = spot.get('drop_at') if step == 'drop' else spot.get('approach')
    wp = (waypoints or {}).get(at)
    if wp is None:
        return None, f'clearing config for {stop!r} names an unknown waypoint {at!r}'
    if robot_xy is None or math.hypot(robot_xy[0] - wp['x'], robot_xy[1] - wp['y']) > REACH_M:
        return None, f'the robot is not at {at} (must be within {REACH_M} m)'
    if step == 'pick':
        items = spot.get('items') or []
        if not items:
            return None, f'no items to pick up at {stop!r}'
        return [{'name': it['name'], 'pose': {'x': float(it['x']), 'y': float(it['y']), 'z': STASH_Z}} for it in items], None
    if step == 'drop':
        items, b = spot.get('items') or [], spot.get('bin')
        if not items or not b:
            return None, f'no items or bin for {stop!r}'
        out = []
        for i, it in enumerate(items):  # side by side in the bin, resting on its rim height
            dx = (i % 2) * 0.12 - 0.06
            dy = (i // 2) * 0.12 - 0.06
            out.append({'name': it['name'], 'pose': {'x': float(b['x']) + dx, 'y': float(b['y']) + dy, 'z': float(b['z']) + float(it.get('z', 0.05))}})
        return out, None
    marks = spot.get('wipe') or []
    if not marks:
        return None, f'nothing to wipe at {stop!r}'
    return [{'name': m['name'], 'pose': {'x': float(m['x']), 'y': float(m['y']), 'z': STASH_Z}} for m in marks], None


def gz_set_pose_args(world, name, pose):
    """argv for `gz service` that moves one model (gz-sim UserCommands, /world/<world>/set_pose)."""
    req = f'name: "{name}" position: {{ x: {pose["x"]:.3f} y: {pose["y"]:.3f} z: {pose["z"]:.3f} }}'
    return ['gz', 'service', '-s', f'/world/{world}/set_pose', '--reqtype', 'gz.msgs.Pose',
            '--reptype', 'gz.msgs.Boolean', '--timeout', '3000', '--req', req]
