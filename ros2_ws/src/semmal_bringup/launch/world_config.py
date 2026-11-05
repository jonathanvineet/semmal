"""Resolve a world name to its generated SDF, spawn pose, waypoint allowlist and geofence."""
import os

import yaml
from ament_index_python.packages import get_package_share_directory


def resolve(world):
    gz = get_package_share_directory('semmal_gazebo')
    nav = get_package_share_directory('semmal_navigation')
    layout_file = os.path.join(gz, 'config', 'worlds', f'{world}.yaml')
    if not os.path.exists(layout_file):
        known = sorted(os.path.splitext(f)[0] for f in os.listdir(os.path.join(gz, 'config', 'worlds')))
        raise RuntimeError(f'unknown world {world!r}; available: {", ".join(known)}')
    with open(layout_file, encoding='utf-8') as f:
        layout = yaml.safe_load(f)
    waypoints_file = os.path.join(nav, 'config', 'waypoints', f'{world}.yaml')
    with open(waypoints_file, encoding='utf-8') as f:
        wp = yaml.safe_load(f)
    g = wp['geofence']
    spawn = layout['robot_spawn']
    return {
        'sdf': os.path.join(gz, 'worlds', f'{world}.sdf'),
        'spawn': (float(spawn['x']), float(spawn['y']), float(spawn.get('yaw', 0.0))),
        'waypoints_file': waypoints_file,
        'geofence': [float(g['min_x']), float(g['min_y']), float(g['max_x']), float(g['max_y'])],
    }
