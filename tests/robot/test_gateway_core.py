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


def test_mission_validation_allowlist_and_limits():
    goal, err = validate_mission({'taskId': 't1', 'waypoints': ['inspection_point_A'], 'maxSpeed': 9, 'captureKeyframe': True}, WPS)
    assert err is None and goal['max_speed'] == 0.4 and goal['capture_keyframe'] is True
    assert validate_mission({'taskId': 't1', 'waypoints': ['kitchen']}, WPS)[1].startswith('not in the waypoint allowlist')
    assert validate_mission({'waypoints': ['dock']}, WPS)[1] == 'taskId required'
    assert validate_mission({'taskId': 't', 'waypoints': []}, WPS)[1] == 'waypoints must be 1-10 names'
