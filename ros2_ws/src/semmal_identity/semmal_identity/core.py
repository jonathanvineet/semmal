"""Robot identity facts (pure, testable without ROS).

The facts say which supported robot this is and what is actually loaded:
  model        create3 | turtlebot4 | jackal (the hardware this robot is, or stands in for)
  runtime      gazebo (the robot runs in Gazebo on this PC) | hardware (the real robot)
  body         the robot description variant that is loaded (cleaner | rover | field)
  description  sha256 of the loaded robot_description (first 16 hex), so the identity is tied to it
  sensors      sensor types declared in the loaded description
plus OS, ROS distro, world and a salted machine hash. No serials, MACs, hostnames or user names.
The device identity service (services/robot-master, `pnpm identify`) signs these facts with the
robot's own key; the platform decides from them whether the model is supported.
"""
import hashlib
import os
import re

MODELS = ('create3', 'turtlebot4', 'jackal')
SENSOR_RE = re.compile(r'<sensor\b[^>]*\btype="([a-z_]+)"')


def sensors_in(description):
    return sorted(set(SENSOR_RE.findall(description or '')))


def _read(path):
    try:
        with open(path, encoding='utf-8') as f:
            return f.read().replace('\0', '').strip()
    except OSError:
        return ''


def os_name(root='/'):
    m = re.search(r'^PRETTY_NAME="?([^"\n]*)"?', _read(os.path.join(root, 'etc/os-release')), re.M)
    return m.group(1)[:80] if m else ''


def machine_hash(root='/'):
    mid = _read(os.path.join(root, 'etc/machine-id'))
    return hashlib.sha256(f'semmal-machine:{mid}'.encode()).hexdigest()[:16] if mid else ''


def usb_devices(root='/', limit=6):
    base = os.path.join(root, 'sys/bus/usb/devices')
    out = []
    if not os.path.isdir(base):
        return out
    for d in sorted(os.listdir(base)):
        vid = _read(os.path.join(base, d, 'idVendor'))
        if not vid:
            continue
        name = re.sub(r'[^\x20-\x7e]', '', _read(os.path.join(base, d, 'product')))[:40]
        if name.lower().endswith('hub'):
            continue
        out.append(f"{vid}:{_read(os.path.join(base, d, 'idProduct'))}{' ' + name if name else ''}")
    return out[:limit]


def facts(*, model, runtime, body, description, world='', ros_distro='', root='/'):
    if model not in MODELS:
        raise ValueError(f'unknown hardware model {model!r}; supported: {", ".join(MODELS)}')
    if runtime not in ('gazebo', 'hardware'):
        raise ValueError('runtime must be gazebo or hardware')
    f = {
        'model': model,
        'runtime': runtime,
        'body': body or '',
        'description': hashlib.sha256((description or '').encode()).hexdigest()[:16] if description else '',
        'sensors': ','.join(sensors_in(description)),
        'world': world or '',
        'rosDistro': ros_distro or '',
        'os': os_name(root),
        'machine': machine_hash(root),
    }
    if runtime == 'hardware':
        f['usb'] = ', '.join(usb_devices(root))[:160]
    return {k: v for k, v in f.items() if v}
