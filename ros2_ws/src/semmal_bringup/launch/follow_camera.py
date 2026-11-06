#!/usr/bin/env python3
"""Make the Gazebo GUI camera follow the robot, and check that it really does.

Gazebo's /gui/follow service answers "true" even when the GUI has no such entity in its scene (it
then silently follows nothing), so this checks the result. Each attempt first lifts the camera to an
overview 25 m up, then asks to follow; only a camera that really follows comes back down next to the
robot (/gui/camera/pose vs the robot's pose in the server). If it stays up there, that overview is
what the user is left with. Retries until it follows or the deadline.

  follow_camera.py [model_name] [deadline_s]
"""
import math
import re
import subprocess
import sys
import time

MODEL = sys.argv[1] if len(sys.argv) > 1 else 'semmal'
DEADLINE_S = float(sys.argv[2]) if len(sys.argv) > 2 else 120.0
OFFSET = 'x: -3.6, y: 0, z: 2.0'  # low chase view from behind (robot frame, m); the window's narrow lens zooms in and its 1.8 m near clip hides walls right behind the camera
NEAR_M = 4.5                       # camera this close (xy) to the robot ...
LOW_M = 12.0                       # ... and this low = following (the overview is at 25 m)
OVERVIEW = 'pose: {position: {x: 0, y: 0, z: 25}, orientation: {x: 0, y: 0.7071, z: 0, w: 0.7071}}'


def run(cmd, timeout=5.0):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout).stdout
    except subprocess.TimeoutExpired:
        return ''


def robot_xy():
    out = run(['gz', 'model', '-m', MODEL, '-p'])
    m = re.search(r'XYZ.*\n\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)', out)
    return (float(m.group(1)), float(m.group(2))) if m else None


def camera_xyz():
    out = run(['gz', 'topic', '-e', '-t', '/gui/camera/pose', '-n', '1'], timeout=4.0)
    m = re.search(r'position\s*\{([^}]*)\}', out)
    if not m:
        return None
    v = dict(re.findall(r'([xyz]):\s*(-?[\d.e+-]+)', m.group(1)))  # zero fields are omitted
    return tuple(float(v.get(k, 0.0)) for k in 'xyz')


def service(name, reqtype, req):
    out = run(['gz', 'service', '-s', name, '--reqtype', reqtype, '--reptype', 'gz.msgs.Boolean',
               '--timeout', '1000', '--req', req])
    return 'true' in out


def main():
    end = time.monotonic() + DEADLINE_S
    while time.monotonic() < end:
        r = robot_xy()
        if r and service('/gui/move_to/pose', 'gz.msgs.GUICamera', OVERVIEW):
            time.sleep(1.0)
            if service('/gui/follow/offset', 'gz.msgs.Vector3d', OFFSET) \
                    and service('/gui/follow', 'gz.msgs.StringMsg', f'data: "{MODEL}"'):
                time.sleep(4.0)  # the camera glides toward its target
            r, c = robot_xy(), camera_xyz()
            if r and c and c[2] < LOW_M and math.dist(r, c[:2]) < NEAR_M:
                print(f'[follow] GUI camera follows {MODEL}', flush=True)
                return 0
        time.sleep(1.0)
    print(f'[follow] the Gazebo GUI is not showing {MODEL}; camera left free. '
          'Reopen the window with scripts/robot/gui.sh', file=sys.stderr, flush=True)
    return 1


if __name__ == '__main__':
    sys.exit(main())
