import os

import pytest

from conftest import SRC
from semmal_sim_faults.scenarios import ScenarioError, load_dir, simulation_allowed, validate


def test_shipped_scenarios_load():
    s = load_dir(os.path.join(SRC, 'semmal_sim_faults', 'scenarios'))
    assert s['left_motor_overcurrent']['current_a'] == 8.5
    assert s['left_encoder_dropout']['encoder_stale'] is True


def test_invalid_scenarios_rejected():
    with pytest.raises(ScenarioError):
        validate({'scenario_id': 'x', 'fault': {'motor': 'middle'}, 'duration_ms': 10})
    with pytest.raises(ScenarioError):
        validate({'scenario_id': 'x', 'fault': {'motor': 'left'}, 'duration_ms': 10})  # no effect


def test_injector_refuses_outside_simulation():
    assert not simulation_allowed({})
    assert not simulation_allowed({'APP_MODE': 'production'})
    assert not simulation_allowed({'APP_MODE': 'simulation', 'SIM_FAULT_INJECTION_ENABLED': 'false'})
    assert simulation_allowed({'APP_MODE': 'simulation'})
