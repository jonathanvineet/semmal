#!/usr/bin/env python3
"""Render PNG snapshots of a Gazebo world from named viewpoints (headless, offline).

Injects one camera per view into a temporary copy of the world, runs `gz sim -s --headless-rendering`,
subscribes to each camera over gz-transport (cameras only render when someone subscribes) and saves
the first frame received after a short settle time.

  render_views.py WORLD.sdf OUT_DIR --view NAME EX EY EZ TX TY TZ [--view ...] [--size 1280x720] [--fov 1.2]
  render_views.py WORLD.sdf OUT_DIR --views views.yaml      # {views: {name: {eye: [x,y,z], target: [x,y,z], fov: f}}}
"""
import argparse
import math
import os
import re
import signal
import struct
import subprocess
import sys
import tempfile
import threading
import time
import zlib

import yaml


def look_at_rpy(eye, target):
    dx, dy, dz = (t - e for t, e in zip(target, eye))
    yaw = math.atan2(dy, dx)
    pitch = math.atan2(-dz, math.hypot(dx, dy))  # gz: positive pitch looks down
    return 0.0, pitch, yaw


def camera_model(name, eye, target, w, h, fov):
    r, p, y = look_at_rpy(eye, target)
    return f"""
    <model name="__view_{name}">
      <static>true</static>
      <pose>{eye[0]} {eye[1]} {eye[2]} {r} {p} {y}</pose>
      <link name="l">
        <sensor name="cam" type="camera">
          <topic>/semmal_preview/{name}</topic>
          <always_on>1</always_on>
          <update_rate>4</update_rate>
          <camera>
            <horizontal_fov>{fov}</horizontal_fov>
            <image><width>{w}</width><height>{h}</height><format>R8G8B8</format></image>
            <clip><near>0.05</near><far>200</far></clip>
          </camera>
        </sensor>
      </link>
    </model>"""


def write_png(path, w, h, rgb):
    raw = b''.join(b'\x00' + rgb[r * w * 3:(r + 1) * w * 3] for r in range(h))

    def chunk(t, b):
        return struct.pack('>I', len(b)) + t + b + struct.pack('>I', zlib.crc32(t + b) & 0xffffffff)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b''))


def render(world_path, out_dir, views, size=(1280, 720), settle_s=4.0, timeout_s=120.0):
    from gz.msgs10.image_pb2 import Image
    from gz.transport13 import Node

    with open(world_path, encoding='utf-8') as f:
        sdf = f.read()
    w, h = size
    cams = ''.join(camera_model(n, v['eye'], v['target'], w, h, v.get('fov', 1.2)) for n, v in views.items())
    # Ensure a rendering Sensors system exists.
    if 'gz-sim-sensors-system' not in sdf:
        cams += ('\n    <plugin filename="gz-sim-sensors-system" name="gz::sim::systems::Sensors">'
                 '<render_engine>ogre2</render_engine></plugin>')
    sdf = re.sub(r'</world>', cams + '\n  </world>', sdf, count=1)
    os.makedirs(out_dir, exist_ok=True)
    tmp = tempfile.NamedTemporaryFile('w', suffix='.sdf', delete=False,
                                      dir=os.path.dirname(os.path.abspath(world_path)))
    tmp.write(sdf)
    tmp.close()

    node = Node()
    t0 = [None]
    saved = {}
    lock = threading.Lock()

    def make_cb(name):
        def cb(msg: Image):
            if t0[0] is None or time.monotonic() - t0[0] < settle_s:
                return
            with lock:
                if name in saved:
                    return
                saved[name] = True
            path = os.path.join(out_dir, f'{name}.png')
            write_png(path, msg.width, msg.height, msg.data[:msg.width * msg.height * 3])
            print(f'saved {path}', flush=True)
        return cb

    for name in views:
        node.subscribe(Image, f'/semmal_preview/{name}', make_cb(name))
    env = dict(os.environ)
    proc = subprocess.Popen(['gz', 'sim', '-s', '-r', '--headless-rendering', tmp.name],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env,
                            start_new_session=True)
    try:
        t0[0] = time.monotonic()
        end = time.monotonic() + timeout_s
        while time.monotonic() < end and len(saved) < len(views):
            time.sleep(0.2)
            if proc.poll() is not None:
                raise RuntimeError(f'gz sim exited with code {proc.returncode}')
    finally:
        os.killpg(proc.pid, signal.SIGINT)
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
        os.unlink(tmp.name)
    missing = [n for n in views if n not in saved]
    if missing:
        raise RuntimeError(f'no frame for views: {missing}')
    return [os.path.join(out_dir, f'{n}.png') for n in views]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('world')
    ap.add_argument('out_dir')
    ap.add_argument('--view', nargs=7, action='append', metavar=('NAME', 'EX', 'EY', 'EZ', 'TX', 'TY', 'TZ'))
    ap.add_argument('--views', help='YAML file with {views: {name: {eye, target, fov}}}')
    ap.add_argument('--size', default='1280x720')
    ap.add_argument('--fov', type=float, default=1.2)
    ap.add_argument('--settle', type=float, default=4.0)
    a = ap.parse_args(argv)
    views = {}
    if a.views:
        with open(a.views, encoding='utf-8') as f:
            views.update(yaml.safe_load(f)['views'])
    for v in a.view or []:
        views[v[0]] = {'eye': [float(x) for x in v[1:4]], 'target': [float(x) for x in v[4:7]], 'fov': a.fov}
    if not views:
        ap.error('no views given')
    w, h = (int(x) for x in a.size.split('x'))
    render(a.world, a.out_dir, views, (w, h), a.settle)
    return 0


if __name__ == '__main__':
    sys.exit(main())
