"""World layouts, generated artefacts and route graphs stay consistent (every world)."""
import math
import os

import pytest

from conftest import SRC
import generate_world as gw
from semmal_mission.route import RouteGraph

WORLDS = sorted(os.path.splitext(f)[0] for f in os.listdir(gw.WORLDS_DIR) if f.endswith('.yaml'))


def waypoints(world):
    return RouteGraph.load(os.path.join(SRC, 'semmal_navigation', 'config', 'waypoints', f'{world}.yaml'))


def point_poly_distance(p, poly):
    if gw._point_in_poly(p[0], p[1], poly):
        return 0.0
    best = math.inf
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        L2 = dx * dx + dy * dy
        t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2))
        best = min(best, math.dist(p, (a[0] + t * dx, a[1] + t * dy)))
    return best


def seg_poly_distance(a, b, poly, step=0.02):
    n = max(1, int(math.dist(a, b) / step))
    return min(point_poly_distance((a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n), poly)
               for i in range(n + 1))


def test_worlds_present():
    assert {'warehouse', 'house'} <= set(WORLDS)


@pytest.mark.parametrize('world', WORLDS)
def test_generated_files_are_up_to_date(world, tmp_path):
    layout = gw.load_layout(gw.layout_path(world))
    with open(os.path.join(SRC, 'semmal_gazebo', 'worlds', f'{world}.sdf')) as f:
        assert f.read() == gw.render_sdf(layout), 'run semmal_gazebo/scripts/generate_world.py'
    gw.write_map(layout, str(tmp_path))
    with open(tmp_path / f'{world}.pgm', 'rb') as a, \
            open(os.path.join(SRC, 'semmal_navigation', 'maps', f'{world}.pgm'), 'rb') as b:
        assert a.read() == b.read(), 'run semmal_gazebo/scripts/generate_world.py'


@pytest.mark.parametrize('world', WORLDS)
def test_every_route_edge_clears_obstacles(world):
    layout = gw.load_layout(gw.layout_path(world))
    g = waypoints(world)
    solids = gw.blocking_solids(layout)
    bad = []
    for a, b in g.edges:
        for s in solids:
            d = seg_poly_distance(g.points[a], g.points[b], s['poly'])
            if d < g.robot_radius:
                bad.append(f'{a}-{b} is {d:.2f} m from {s["name"]}')
    assert not bad, '\n'.join(bad)


@pytest.mark.parametrize('world', WORLDS)
def test_waypoints_in_geofence_and_spawn_is_dock(world):
    layout = gw.load_layout(gw.layout_path(world))
    g = waypoints(world)
    for name, (x, y, _yaw) in g.waypoints.items():
        assert g.in_geofence(x, y), name
    s = layout['robot_spawn']
    assert (s['x'], s['y']) == g.waypoints['dock'][:2]


@pytest.mark.parametrize('world', WORLDS)
def test_all_waypoints_reachable_from_dock(world):
    g = waypoints(world)
    for name in g.waypoints:
        pts = g.plan(g.waypoints['dock'][:2], name)
        assert pts[-1][2] == name


def shrink(poly, d):
    """Shrink a rectangle (4 corners, any rotation) by d on every side."""
    cx = sum(p[0] for p in poly) / 4
    cy = sum(p[1] for p in poly) / 4
    out = []
    for i, p in enumerate(poly):
        # move the corner inwards along both adjacent edges
        a, b = poly[i - 1], poly[(i + 1) % 4]
        ux, uy = a[0] - p[0], a[1] - p[1]
        vx, vy = b[0] - p[0], b[1] - p[1]
        lu, lv = math.hypot(ux, uy), math.hypot(vx, vy)
        out.append((p[0] + d * (ux / lu + vx / lv), p[1] + d * (uy / lu + vy / lv)))
    assert all(math.dist(q, (cx, cy)) < math.dist(p, (cx, cy)) for p, q in zip(poly, out))
    return out


def convex_overlap(p, q):
    """Separating-axis test for two convex polygons."""
    for poly in (p, q):
        for i in range(len(poly)):
            a, b = poly[i], poly[(i + 1) % len(poly)]
            nx, ny = b[1] - a[1], a[0] - b[0]
            pa = [nx * v[0] + ny * v[1] for v in p]
            pb = [nx * v[0] + ny * v[1] for v in q]
            if max(pa) <= min(pb) or max(pb) <= min(pa):
                return False
    return True


def test_convex_overlap_helper():
    sq = gw.rect_poly(0, 0, 1, 1)
    assert convex_overlap(sq, gw.rect_poly(0.9, 0, 1, 1))
    assert not convex_overlap(sq, gw.rect_poly(1.05, 0, 1, 1))
    assert not convex_overlap(shrink(gw.rect_poly(0.98, 0, 1, 1), 0.03), sq)


@pytest.mark.parametrize('world', WORLDS)
def test_furniture_does_not_penetrate_walls_or_each_other(world):
    """Furniture may touch walls/neighbours (3 cm tolerance) but must not sit inside them."""
    layout = gw.load_layout(gw.layout_path(world))
    walls = [gw.box_solid(o) for o in gw.wall_boxes(layout) + gw.interior_wall_boxes(layout)]
    items = [f for f in gw.furniture_items(layout) if f['poly']]
    bad = []
    for i, f in enumerate(items):
        core = shrink(f['poly'], 0.03)
        for w in walls:
            if convex_overlap(core, w['poly']):
                bad.append(f'{f["name"]} penetrates {w["name"]}')
        for g in items[i + 1:]:
            stacked = f['zmax'] <= g['zmin'] + 0.02 or g['zmax'] <= f['zmin'] + 0.02
            if not stacked and convex_overlap(core, shrink(g['poly'], 0.03)):
                bad.append(f'{f["name"]} overlaps {g["name"]}')
    assert not bad, '\n'.join(bad)


def test_house_inspection_point_faces_electrical_box():
    layout = gw.load_layout(gw.layout_path('house'))
    g = waypoints('house')
    x, y, yaw = g.waypoints['inspection_point_A']
    box = next(f for f in gw.furniture_items(layout) if f['name'] == 'electrical_box')
    bearing = math.atan2(box['y'] - y, box['x'] - x)
    assert abs(math.atan2(math.sin(bearing - yaw), math.cos(bearing - yaw))) < 0.1
    assert 1.0 < math.dist((x, y), (box['x'], box['y'])) < 2.5


def test_warehouse_inspection_point_faces_machine_panel():
    layout = gw.load_layout(gw.layout_path('warehouse'))
    g = waypoints('warehouse')
    x, y, yaw = g.waypoints['inspection_point_A']
    panel = next(m for m in layout['markers'] if m['name'] == 'machine_panel')
    bearing = math.atan2(panel['y'] - y, panel['x'] - x)
    assert abs(math.atan2(math.sin(bearing - yaw), math.cos(bearing - yaw))) < 0.1
