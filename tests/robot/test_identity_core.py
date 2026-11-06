"""Identity facts: tied to the loaded description, honest about runtime, no personal data."""
import os

import pytest

from semmal_identity.core import MODELS, facts, sensors_in
from hardware_config import HARDWARE, body_for

URDF = '<robot><gazebo><sensor name="lidar" type="gpu_lidar"/><sensor name="camera" type="camera"/><sensor type="imu" name="imu"/></gazebo></robot>'


def fake_root(tmp_path, usb=False):
    (tmp_path / 'etc').mkdir()
    (tmp_path / 'etc/os-release').write_text('NAME="Ubuntu"\nPRETTY_NAME="Ubuntu 24.04.2 LTS"\n')
    (tmp_path / 'etc/machine-id').write_text('0123456789abcdef0123456789abcdef\n')
    if usb:
        d = tmp_path / 'sys/bus/usb/devices/1-2'
        d.mkdir(parents=True)
        (d / 'idVendor').write_text('0483')
        (d / 'idProduct').write_text('5740')
        (d / 'product').write_text('OpenCR')
        h = tmp_path / 'sys/bus/usb/devices/usb1'
        h.mkdir()
        (h / 'idVendor').write_text('1d6b')
        (h / 'product').write_text('xHCI Host Controller Hub')
    return str(tmp_path)


def test_sensors_come_from_the_loaded_description():
    assert sensors_in(URDF) == ['camera', 'gpu_lidar', 'imu']
    assert sensors_in('') == []


def test_gazebo_facts(tmp_path):
    f = facts(model='create3', runtime='gazebo', body='cleaner', description=URDF, world='house', ros_distro='jazzy', root=fake_root(tmp_path))
    assert f['model'] == 'create3' and f['runtime'] == 'gazebo' and f['body'] == 'cleaner'
    assert f['sensors'] == 'camera,gpu_lidar,imu'
    assert len(f['description']) == 16 and len(f['machine']) == 16
    assert f['os'] == 'Ubuntu 24.04.2 LTS'
    assert 'usb' not in f
    assert '0123456789abcdef' not in str(f), 'the raw machine id never leaves the machine'


def test_a_different_description_changes_the_identity(tmp_path):
    r = fake_root(tmp_path)
    a = facts(model='turtlebot4', runtime='gazebo', body='rover', description=URDF, root=r)
    b = facts(model='turtlebot4', runtime='gazebo', body='rover', description=URDF + ' ', root=r)
    assert a['description'] != b['description']


def test_hardware_runtime_lists_usb_devices_but_not_hubs(tmp_path):
    f = facts(model='turtlebot4', runtime='hardware', body='rover', description=URDF, root=fake_root(tmp_path, usb=True))
    assert f['usb'] == '0483:5740 OpenCR'


def test_unknown_model_or_runtime_is_refused():
    with pytest.raises(ValueError):
        facts(model='roomba', runtime='gazebo', body='x', description=URDF)
    with pytest.raises(ValueError):
        facts(model='create3', runtime='emulated', body='x', description=URDF)


def test_launch_and_identity_agree_on_the_models():
    assert set(MODELS) == set(HARDWARE)
    assert {m: body_for(m) for m in MODELS} == {'create3': 'cleaner', 'turtlebot4': 'rover', 'jackal': 'field'}
