import os

import pytest

from conftest import SRC
from semmal_mission.route import RouteError, RouteGraph
from semmal_mission.controller import ControllerConfig, go_to

G = RouteGraph.load(os.path.join(SRC, 'semmal_navigation', 'config', 'waypoints', 'warehouse.yaml'))


def test_plan_dock_to_inspection_follows_aisle():
    names = [n for _x, _y, n in G.plan((-8.0, -5.5), 'inspection_point_A')]
    assert names[0] == 'dock' or names[0] == '_join' or names[0] == 'w_south'
    assert names[-1] == 'inspection_point_A'
    assert 'e_aisle2' in names


def test_rejects_non_allowlisted_targets():
    for bad in ('w_south', 'nowhere', ''):
        with pytest.raises(RouteError):
            G.plan((-8.0, -5.5), bad)


def test_plan_from_mid_edge_joins_graph():
    pts = G.plan((0.0, -5.0), 'destination')
    assert pts[0][2] == '_join' and abs(pts[0][1] + 5.2) < 1e-6
    assert pts[-1][2] == 'destination'


def test_controller_rotates_before_driving():
    v, w, done, _ = go_to((0, 0, 0), (0, 1), True, ControllerConfig())
    assert v == 0 and w > 0 and not done
    v, w, done, _ = go_to((0, 0, 0), (2, 0), True, ControllerConfig(), max_speed=0.2)
    assert 0 < v <= 0.2 and abs(w) < 1e-9
