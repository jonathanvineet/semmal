#!/usr/bin/env python3
"""Render world layouts (config/worlds/<name>.yaml) into Gazebo SDF worlds and static occupancy maps.

Usage: generate_world.py [WORLD ...]            # default: every config/worlds/*.yaml
Outputs: semmal_gazebo/worlds/<name>.sdf, semmal_navigation/maps/<name>.{pgm,yaml}
Deterministic: same inputs -> byte-identical outputs.

Layout keys: floor, walls (outer, automatic), interior_walls (axis-aligned segments with door gaps),
rooms (visual floor finishes), obstacles (solid boxes), furniture (Fuel models from config/models.yaml,
footprints from config/model_catalog.yaml), markers (visual only), robot_spawn, map.
"""
import argparse
import glob
import math
import os
import sys

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
SRC = os.path.dirname(PKG)
WORLDS_DIR = os.path.join(PKG, 'config', 'worlds')
FACING = {'east': 0.0, 'north': 90.0, 'west': 180.0, 'south': -90.0}


def load_yaml(path):
    with open(path, 'r', encoding='utf-8') as f:
        return yaml.safe_load(f)


def load_layout(path):
    return load_yaml(path)


def layout_path(name):
    return os.path.join(WORLDS_DIR, f'{name}.yaml')


def load_models():
    models = load_yaml(os.path.join(PKG, 'config', 'models.yaml'))['models']
    catalog = load_yaml(os.path.join(PKG, 'config', 'model_catalog.yaml'))['models']
    return models, catalog


# ----------------------------------------------------------------------------- geometry
def rect_poly(cx, cy, sx, sy):
    return [(cx - sx / 2, cy - sy / 2), (cx + sx / 2, cy - sy / 2), (cx + sx / 2, cy + sy / 2), (cx - sx / 2, cy + sy / 2)]


def _r(v):
    return round(v, 4) + 0.0  # normalise -0.0


def box_solid(o, zmin=0.0):
    return {'name': o['name'], 'poly': rect_poly(o['x'], o['y'], o['sx'], o['sy']),
            'zmin': zmin, 'zmax': zmin + o['sz'], 'box': o}


def wall_boxes(layout):
    """Outer walls (boxes) around the floor."""
    fx, fy = layout['floor']['size_x'], layout['floor']['size_y']
    w = layout['walls']
    t, h = w['thickness'], w['height']
    c = w.get('rgba', [0.75, 0.75, 0.72, 1])
    return [
        {'name': 'wall_north', 'x': 0.0, 'y': fy / 2 + t / 2, 'sx': fx + 2 * t, 'sy': t, 'sz': h, 'rgba': c},
        {'name': 'wall_south', 'x': 0.0, 'y': -fy / 2 - t / 2, 'sx': fx + 2 * t, 'sy': t, 'sz': h, 'rgba': c},
        {'name': 'wall_east', 'x': fx / 2 + t / 2, 'y': 0.0, 'sx': t, 'sy': fy, 'sz': h, 'rgba': c},
        {'name': 'wall_west', 'x': -fx / 2 - t / 2, 'y': 0.0, 'sx': t, 'sy': fy, 'sz': h, 'rgba': c},
    ]


def interior_wall_boxes(layout):
    iw = layout.get('interior_walls')
    if not iw:
        return []
    t = iw['thickness']
    h = layout['walls']['height']
    c = iw.get('rgba', [0.9, 0.9, 0.85, 1])
    out = []
    for i, seg in enumerate(iw['segments']):
        (x0, y0), (x1, y1) = seg['from'], seg['to']
        horizontal = abs(y1 - y0) < 1e-9
        if not horizontal and abs(x1 - x0) > 1e-9:
            raise ValueError(f'interior wall {i} is not axis-aligned')
        a0, a1 = (min(x0, x1), max(x0, x1)) if horizontal else (min(y0, y1), max(y0, y1))
        cuts = sorted((d['at'] - d['width'] / 2, d['at'] + d['width'] / 2) for d in seg.get('doors', []))
        pieces, cur = [], a0
        for g0, g1 in cuts:
            if not (a0 < g0 < g1 < a1):
                raise ValueError(f'door {g0:.2f}..{g1:.2f} outside wall {i}')
            if g0 > cur:
                pieces.append((cur, g0))
            cur = g1
        if cur < a1:
            pieces.append((cur, a1))
        for j, (p0, p1) in enumerate(pieces):
            L = p1 - p0
            if horizontal:
                out.append({'name': f'iwall_{i}_{j}', 'x': _r((p0 + p1) / 2), 'y': y0, 'sx': _r(L), 'sy': t, 'sz': h, 'rgba': c})
            else:
                out.append({'name': f'iwall_{i}_{j}', 'x': x0, 'y': _r((p0 + p1) / 2), 'sx': t, 'sy': _r(L), 'sz': h, 'rgba': c})
    return out


def furniture_items(layout, models=None, catalog=None):
    """Resolve furniture entries -> dicts with name, uri, pose, yaw (rad) and world footprint polygon."""
    items = layout.get('furniture') or []
    if not items:
        return []
    if models is None:
        models, catalog = load_models()
    out, counts = [], {}
    for f in items:
        key = f['model']
        if key not in models:
            raise ValueError(f'unknown model {key!r} (add it to config/models.yaml)')
        facing = f.get('facing', 'east')
        facing_deg = FACING[facing] if isinstance(facing, str) else float(facing)
        yaw = math.radians(facing_deg - models[key]['front_deg'])
        yaw = math.atan2(math.sin(yaw), math.cos(yaw))
        counts[key] = counts.get(key, 0) + 1
        name = f.get('name') or f'{key}_{counts[key]}'
        z = float(f.get('z', 0.0))
        box = catalog.get(key)
        poly, zmin, zmax = None, None, None
        if box:
            (mx0, my0, mz0), (mx1, my1, mz1) = box['min'], box['max']
            c, s = math.cos(yaw), math.sin(yaw)
            poly = [(f['x'] + c * px - s * py, f['y'] + s * px + c * py)
                    for px, py in ((mx0, my0), (mx1, my0), (mx1, my1), (mx0, my1))]
            zmin, zmax = z + mz0, z + mz1
        out.append({'name': name, 'model': key, 'uri': models[key]['uri'], 'x': f['x'], 'y': f['y'], 'z': z,
                    'yaw': _r(yaw), 'poly': poly, 'zmin': zmin, 'zmax': zmax})
    return out


def all_solids(layout):
    """Every collidable thing as {name, poly, zmin, zmax}. Boxes keep a 'box' entry for SDF rendering."""
    solids = [box_solid(o) for o in wall_boxes(layout) + interior_wall_boxes(layout)]
    solids += [box_solid(o) for o in layout.get('obstacles', [])]
    solids += [{'name': f['name'], 'poly': f['poly'], 'zmin': f['zmin'], 'zmax': f['zmax']}
               for f in furniture_items(layout) if f['poly']]
    return solids


def blocking_solids(layout):
    """Solids that obstruct a ground robot (some part below map.max_obstacle_z)."""
    zmax = layout['map'].get('max_obstacle_z', 10.0)
    return [s for s in all_solids(layout) if s['zmin'] < zmax and s['zmax'] > 0.02]


# ---------------------------------------------------------------------------------- SDF
def _rgba(c):
    return ' '.join(f'{v:g}' for v in c)


def box_model(o, z_centre=None, collide=True):
    z = o['sz'] / 2 if z_centre is None else z_centre
    col = (f"""
        <collision name="collision">
          <geometry><box><size>{o['sx']:g} {o['sy']:g} {o['sz']:g}</size></box></geometry>
        </collision>""" if collide else '')
    return f"""
    <model name="{o['name']}">
      <static>true</static>
      <pose>{o['x']:g} {o['y']:g} {z:g} 0 0 0</pose>
      <link name="link">{col}
        <visual name="visual">
          <geometry><box><size>{o['sx']:g} {o['sy']:g} {o['sz']:g}</size></box></geometry>
          <material><ambient>{_rgba(o['rgba'])}</ambient><diffuse>{_rgba(o['rgba'])}</diffuse></material>
        </visual>
      </link>
    </model>"""


def include_model(f):
    return f"""
    <include>
      <uri>{f['uri']}</uri>
      <name>{f['name']}</name>
      <pose>{f['x']:g} {f['y']:g} {f['z']:g} 0 0 {f['yaw']:g}</pose>
      <static>true</static>
    </include>"""


def room_floor(r):
    (x0, y0), (x1, y1) = r['min'], r['max']
    return box_model({'name': f"floor_{r['name']}", 'x': _r((x0 + x1) / 2), 'y': _r((y0 + y1) / 2),
                      'sx': _r(x1 - x0), 'sy': _r(y1 - y0), 'sz': 0.002, 'rgba': r['rgba']},
                     z_centre=0.001, collide=False)


def render_sdf(layout):
    fx, fy = layout['floor']['size_x'], layout['floor']['size_y']
    floor_c = layout['floor'].get('rgba', [0.55, 0.55, 0.53, 1])
    boxes = wall_boxes(layout) + interior_wall_boxes(layout) + list(layout.get('obstacles', []))
    models = ''.join(box_model(o) for o in boxes)
    rooms = ''.join(room_floor(r) for r in layout.get('rooms', []))
    furniture = ''.join(include_model(f) for f in furniture_items(layout))
    markers = ''.join(box_model(m, z_centre=m['z'], collide=False) for m in layout.get('markers', []))
    return f"""<?xml version="1.0"?>
<!-- GENERATED by semmal_gazebo/scripts/generate_world.py from config/worlds/{layout['name']}.yaml. Do not edit. -->
<sdf version="1.10">
  <world name="{layout['name']}">
    <physics name="1ms" type="ignored">
      <max_step_size>0.001</max_step_size>
      <real_time_factor>1.0</real_time_factor>
    </physics>
    <plugin filename="gz-sim-physics-system" name="gz::sim::systems::Physics"/>
    <plugin filename="gz-sim-user-commands-system" name="gz::sim::systems::UserCommands"/>
    <plugin filename="gz-sim-scene-broadcaster-system" name="gz::sim::systems::SceneBroadcaster"/>
    <plugin filename="gz-sim-sensors-system" name="gz::sim::systems::Sensors">
      <render_engine>ogre2</render_engine>
    </plugin>
    <plugin filename="gz-sim-imu-system" name="gz::sim::systems::Imu"/>

    <scene>
      <ambient>0.6 0.6 0.6 1</ambient>
      <background>0.85 0.87 0.9 1</background>
      <shadows>false</shadows>
    </scene>

    <light type="directional" name="sun">
      <cast_shadows>false</cast_shadows>
      <pose>0 0 10 0 0 0</pose>
      <diffuse>0.9 0.9 0.9 1</diffuse>
      <specular>0.2 0.2 0.2 1</specular>
      <direction>-0.4 0.2 -0.9</direction>
    </light>

    <model name="floor">
      <static>true</static>
      <link name="link">
        <collision name="collision">
          <geometry><plane><normal>0 0 1</normal><size>{fx + 4:g} {fy + 4:g}</size></plane></geometry>
          <surface><friction><ode><mu>1.0</mu><mu2>1.0</mu2></ode></friction></surface>
        </collision>
        <visual name="visual">
          <geometry><plane><normal>0 0 1</normal><size>{fx:g} {fy:g}</size></plane></geometry>
          <material><ambient>{_rgba(floor_c)}</ambient><diffuse>{_rgba(floor_c)}</diffuse></material>
        </visual>
      </link>
    </model>
{rooms}{models}{furniture}
{markers}
  </world>
</sdf>
"""


# ---------------------------------------------------------------------------------- map
def map_bounds(layout):
    fx, fy = layout['floor']['size_x'], layout['floor']['size_y']
    t = layout['walls']['thickness']
    m = layout['map']['margin']
    return (-fx / 2 - t - m, -fy / 2 - t - m, fx / 2 + t + m, fy / 2 + t + m)


def _point_in_poly(px, py, poly):
    inside = False
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        if (y0 > py) != (y1 > py) and px < (x1 - x0) * (py - y0) / (y1 - y0) + x0:
            inside = not inside
    return inside


def render_map(layout):
    """Return (width, height, rows) where rows[0] is the TOP row (PGM order)."""
    res = layout['map']['resolution']
    x0, y0, x1, y1 = map_bounds(layout)
    w = int(round((x1 - x0) / res))
    h = int(round((y1 - y0) / res))
    grid = [[254] * w for _ in range(h)]  # 254 = free
    for s in blocking_solids(layout):
        xs = [p[0] for p in s['poly']]
        ys = [p[1] for p in s['poly']]
        c0 = max(0, int(math.floor((min(xs) - x0) / res)))
        c1 = min(w, int(math.ceil((max(xs) - x0) / res)))
        r0 = max(0, int(math.floor((min(ys) - y0) / res)))
        r1 = min(h, int(math.ceil((max(ys) - y0) / res)))
        axis_aligned = 'box' in s
        for r in range(r0, r1):
            cy = y0 + (r + 0.5) * res
            row = grid[r]
            for c in range(c0, c1):
                if axis_aligned or _point_in_poly(x0 + (c + 0.5) * res, cy, s['poly']):
                    row[c] = 0  # occupied
    grid.reverse()
    return w, h, grid


def write_map(layout, map_dir):
    w, h, rows = render_map(layout)
    x0, y0, _, _ = map_bounds(layout)
    pgm = os.path.join(map_dir, f"{layout['name']}.pgm")
    with open(pgm, 'wb') as f:
        f.write(f'P5\n# generated from config/worlds/{layout["name"]}.yaml\n{w} {h}\n255\n'.encode())
        f.write(bytes(v for row in rows for v in row))
    with open(os.path.join(map_dir, f"{layout['name']}.yaml"), 'w', encoding='utf-8') as f:
        f.write(
            f"# GENERATED by semmal_gazebo/scripts/generate_world.py. Do not edit.\n"
            f"image: {layout['name']}.pgm\n"
            f"mode: trinary\n"
            f"resolution: {layout['map']['resolution']}\n"
            f"origin: [{x0:.3f}, {y0:.3f}, 0.0]\n"
            f"negate: 0\noccupied_thresh: 0.65\nfree_thresh: 0.25\n")
    return pgm


def generate(name, world_dir=None, map_dir=None):
    layout = load_layout(layout_path(name))
    world_dir = world_dir or os.path.join(PKG, 'worlds')
    map_dir = map_dir or os.path.join(SRC, 'semmal_navigation', 'maps')
    os.makedirs(world_dir, exist_ok=True)
    os.makedirs(map_dir, exist_ok=True)
    sdf_path = os.path.join(world_dir, f'{name}.sdf')
    with open(sdf_path, 'w', encoding='utf-8') as f:
        f.write(render_sdf(layout))
    return sdf_path, write_map(layout, map_dir)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('worlds', nargs='*', help='world names (default: all in config/worlds)')
    a = p.parse_args(argv)
    names = a.worlds or sorted(os.path.splitext(os.path.basename(x))[0]
                               for x in glob.glob(os.path.join(WORLDS_DIR, '*.yaml')))
    for n in names:
        sdf, pgm = generate(n)
        print(f'wrote {sdf}\nwrote {pgm}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
