import base64
import os
import struct
import zlib

from semmal_gateway.core import (availability, downscale, encode_png, keyframe_data_url, read_ppm,
                                 safe_keyframe_path, state_doc, validate_mission, zone_for)

WPS = {'dock': {'x': -8.0, 'y': -5.5}, 'inspection_point_A': {'x': 8.0, 'y': 1.5}}


def write_ppm(path, w, h):
    with open(path, 'wb') as f:
        f.write(f'P6\n# comment\n{w} {h}\n255\n'.encode())
        f.write(bytes((x * 7 + y) % 256 for y in range(h) for x in range(w * 3)))


def test_ppm_roundtrip_and_png(tmp_path):
    p = tmp_path / 'k.ppm'
    write_ppm(p, 64, 48)
    w, h, rgb = read_ppm(str(p))
    assert (w, h, len(rgb)) == (64, 48, 64 * 48 * 3)
    nw, nh, small = downscale(w, h, rgb, 32)
    assert (nw, nh, len(small)) == (32, 24, 32 * 24 * 3)
    png = encode_png(nw, nh, small)
    assert png.startswith(b'\x89PNG\r\n\x1a\n')
    ihdr = png[8 + 8: 8 + 8 + 13]
    assert struct.unpack('>II', ihdr[:8]) == (32, 24)
    idat_len = struct.unpack('>I', png[33:37])[0]
    raw = zlib.decompress(png[41:41 + idat_len])
    assert len(raw) == 24 * (1 + 32 * 3)


def test_keyframe_data_url(tmp_path):
    p = tmp_path / 'k.ppm'
    write_ppm(p, 640, 480)
    d = keyframe_data_url(str(p), max_side=384)
    assert d['width'] == 384 and d['height'] == 288
    assert base64.b64decode(d['dataUrl'].split(',', 1)[1])[:4] == b'\x89PNG'


def test_only_ppm_inside_the_keyframe_dir(tmp_path):
    root = tmp_path / 'keyframes'
    (root / 'task-1').mkdir(parents=True)
    good = root / 'task-1' / 'a.ppm'
    write_ppm(good, 2, 2)
    outside = tmp_path / 'secret.ppm'
    write_ppm(outside, 2, 2)
    assert safe_keyframe_path(str(good), str(root)) == os.path.realpath(good)
    assert safe_keyframe_path(str(root / 'task-1' / '..' / '..' / 'secret.ppm'), str(root)) is None
    assert safe_keyframe_path(str(outside), str(root)) is None
    assert safe_keyframe_path(str(root / 'task-1' / 'missing.ppm'), str(root)) is None


def test_zone_is_coarse():
    assert zone_for(7.5, 1.0, WPS) == 'inspection_point_A'
    assert zone_for(0.0, 0.0, WPS) == 'in_transit'


def test_availability_follows_safety_and_mission():
    assert availability('NORMAL', 'IDLE') == 'available'
    assert availability('NORMAL', 'NAVIGATING') == 'busy'
    assert availability('E_STOP', 'IDLE') == 'busy'
    assert availability(None, 'IDLE', sensors_ready=False) == 'offline'


def test_state_doc_without_sensors_is_honest():
    d = state_doc(safety_state=None, battery_pct=None, x=None, y=None, waypoints=WPS, mission_phase=None,
                  task_id=None, executor_ready=False, hold=False)
    assert d['safetyState'] == 'DEGRADED' and d['availability'] == 'offline' and d['executor'] is False
    assert d['waypoints'] == ['dock', 'inspection_point_A'] and d['world'] is None


def test_mission_validation_allowlist_and_limits():
    goal, err = validate_mission({'taskId': 't1', 'waypoints': ['inspection_point_A'], 'maxSpeed': 9, 'captureKeyframe': True}, WPS)
    assert err is None and goal['max_speed'] == 0.4 and goal['capture_keyframe'] is True
    assert validate_mission({'taskId': 't1', 'waypoints': ['kitchen']}, WPS)[1].startswith('not in the waypoint allowlist')
    assert validate_mission({'waypoints': ['dock']}, WPS)[1] == 'taskId required'
    assert validate_mission({'taskId': 't', 'waypoints': []}, WPS)[1] == 'waypoints must be 1-10 names'


# ------------------------------------------------------------------ clearing
import yaml as _yaml
from semmal_gateway.core import clear_plan, gz_set_pose_args, STASH_Z, state_doc as _state_doc

_HOUSE = os.path.join(os.path.dirname(__file__), '..', '..', 'ros2_ws', 'src', 'semmal_navigation', 'config', 'waypoints', 'house.yaml')


def _house():
    with open(_HOUSE) as f:
        d = _yaml.safe_load(f)
    return d['clearing'], d['waypoints']


def test_house_clearing_config_is_consistent():
    clearing, wps = _house()
    for stop, spot in clearing.items():
        assert stop in wps and spot['approach'] in wps
        if spot.get('items'):
            assert spot['drop_at'] in wps and spot['bin']


def test_pick_needs_the_robot_at_the_spot():
    clearing, wps = _house()
    far = clear_plan(clearing, wps, 'living_room', 'pick', (wps['dock']['x'], wps['dock']['y']))
    assert far[0] is None and 'not at living_room_toys' in far[1]
    assert clear_plan(clearing, wps, 'living_room', 'pick', None)[0] is None
    at = wps['living_room_toys']
    moves, err = clear_plan(clearing, wps, 'living_room', 'pick', (at['x'], at['y']))
    assert err is None and {m['name'] for m in moves} == {'toy_block_red', 'toy_block_blue', 'toy_ball'}
    assert all(m['pose']['z'] == STASH_Z for m in moves)


def test_drop_puts_items_in_the_bin_from_the_drop_spot():
    clearing, wps = _house()
    at = wps['living_room']
    moves, err = clear_plan(clearing, wps, 'living_room', 'drop', (at['x'], at['y']))
    b = clearing['living_room']['bin']
    assert err is None and len(moves) == 3
    for m in moves:
        assert abs(m['pose']['x'] - b['x']) <= 0.1 and abs(m['pose']['y'] - b['y']) <= 0.1 and m['pose']['z'] > b['z']
    assert clear_plan(clearing, wps, 'living_room', 'drop', (wps['living_room_toys']['x'] + 2, wps['living_room_toys']['y']))[0] is None


def test_wipe_and_reset():
    clearing, wps = _house()
    at = wps['kitchen_spill']
    moves, err = clear_plan(clearing, wps, 'kitchen', 'wipe', (at['x'], at['y']))
    assert err is None and [m['name'] for m in moves] == ['spill_kitchen'] and moves[0]['pose']['z'] == STASH_Z
    reset, err = clear_plan(clearing, wps, '', 'reset', None)
    assert err is None and {m['name'] for m in reset} == {'toy_block_red', 'toy_block_blue', 'toy_ball', 'spill_kitchen'}
    assert all(m['pose']['z'] > 0 for m in reset)


def test_only_listed_stops_and_steps():
    clearing, wps = _house()
    assert clear_plan(clearing, wps, 'bedroom', 'pick', (0, 0))[0] is None
    assert clear_plan(clearing, wps, 'living_room', 'explode', (0, 0))[0] is None
    assert clear_plan({}, wps, 'living_room', 'pick', (0, 0))[0] is None


def test_set_pose_command_and_clearable_in_state():
    argv = gz_set_pose_args('house', 'toy_ball', {'x': 1, 'y': -2.5, 'z': 0.3})
    assert argv[:4] == ['gz', 'service', '-s', '/world/house/set_pose'] and 'name: "toy_ball"' in argv[-1]
    clearing, wps = _house()
    doc = _state_doc(safety_state='NORMAL', battery_pct=90, x=0, y=0, waypoints=wps, mission_phase='IDLE', task_id=None,
                     executor_ready=True, hold=False, world='house', clearing=clearing)
    assert sorted(doc['clearing']) == ['kitchen', 'living_room']
    assert doc['clearing']['living_room'] == {'approach': 'living_room_toys', 'dropAt': 'living_room',
                                              'pick': ['toy_block_red', 'toy_block_blue', 'toy_ball'], 'wipe': []}
    assert doc['clearing']['kitchen']['dropAt'] is None and doc['clearing']['kitchen']['wipe'] == ['spill_kitchen']
