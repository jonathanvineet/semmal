"""Safety supervisor state machine: stop/latch/recovery without network or AI."""
import math

from semmal_safety.core import (DEGRADED, E_STOP, NORMAL, RECOVERY_REQUIRED, STOPPING,
                                SafetyConfig, SafetyCore)

HB = ('scan', 'odom', 'wheel_encoders', 'motor_diagnostics')


def feed(core, t, scan_min=5.0):
    for h in HB:
        core.on_heartbeat(h, t)
    core.on_pose(0.0, 0.0)
    core.on_scan([scan_min] * 360, -math.pi, 2 * math.pi / 360, 0.1, 12.0)


def running(t0=0.0):
    c = SafetyCore(SafetyConfig(), t0)
    feed(c, t0)
    c.step(t0)
    return c


def drive(c, t, v=0.4, w=0.0):
    feed(c, t)
    c.on_cmd('nav', v, w, t)
    return c.step(t)


def test_starts_degraded_without_sensors_and_outputs_zero():
    c = SafetyCore(SafetyConfig(), 0.0)
    c.on_cmd('nav', 0.4, 0.0, 0.0)
    o = c.step(0.0)
    assert o.state == DEGRADED and not o.motion_permitted and o.linear == 0.0


def test_normal_drives_with_accel_limit_and_speed_cap():
    c = running()
    o = drive(c, 0.05, v=5.0)
    assert o.state == NORMAL and 0 < o.linear <= 0.8 * 0.05 + 1e-9
    for i in range(2, 60):
        o = drive(c, i * 0.05, v=5.0)
    assert abs(o.linear - SafetyConfig().max_linear) < 1e-9


def test_critical_fault_hard_stops_and_latches_until_operator_approval():
    c = running()
    for i in range(1, 30):
        o = drive(c, i * 0.05)
    assert o.linear > 0.3
    c.on_fault_event('LEFT_MOTOR_OVERCURRENT', 'critical', True)
    o = drive(c, 1.55)
    assert o.state == E_STOP and o.latched and o.linear == 0.0 and o.angular == 0.0
    # Sensor normalises: must NOT resume.
    c.on_fault_event('LEFT_MOTOR_OVERCURRENT', 'critical', False)
    for i in range(32, 80):
        o = drive(c, i * 0.05)
        assert o.linear == 0.0
    assert o.state == RECOVERY_REQUIRED and o.latched
    # Recovery without approval is rejected.
    ok, _ = c.request_recovery('', True, 4.0)
    assert not ok
    ok, _ = c.request_recovery('op-1', False, 4.0)
    assert not ok
    ok, _ = c.request_recovery('op-1', True, 4.0)
    assert ok and c.state == NORMAL
    # Stale pre-recovery command is dropped: motion must be re-commanded.
    feed(c, 4.05)
    assert c.step(4.05).linear == 0.0


def test_recovery_rejected_while_fault_active():
    c = running()
    c.on_fault_event('LEFT_ENCODER_STALE', 'critical', True)
    feed(c, 0.1)
    assert c.step(0.1).state == E_STOP
    ok, msg = c.request_recovery('op-1', True, 0.2)
    assert not ok and 'LEFT_ENCODER_STALE' in msg


def test_estop_input_latches_even_after_release():
    c = running()
    c.on_estop(True)
    feed(c, 0.1)
    assert c.step(0.1).state == E_STOP
    c.on_estop(False)
    feed(c, 0.2)
    o = c.step(0.2)
    assert o.state == RECOVERY_REQUIRED and o.linear == 0.0


def test_heartbeat_loss_triggers_estop_and_internal_fault_event():
    c = running()
    o = drive(c, 0.1)
    # odom stops arriving
    for h in ('scan', 'wheel_encoders', 'motor_diagnostics'):
        c.on_heartbeat(h, 1.0)
    o = c.step(1.0)
    assert o.state == E_STOP
    assert ('HEARTBEAT_LOSS_ODOM', True) in [(code, a) for code, a, _m in o.new_internal_faults]


def test_geofence_violation_stops():
    c = running()
    feed(c, 0.1)
    c.on_pose(50.0, 0.0)
    assert c.step(0.1).state == E_STOP


def test_obstacle_blocks_forward_but_allows_reverse():
    c = running()
    for i in range(1, 40):
        feed(c, i * 0.05, scan_min=0.3)  # 0.3 - 0.0 offset < stop_distance 0.35
        c.on_cmd('nav', 0.4, 0.0, i * 0.05)
        o = c.step(i * 0.05)
    assert o.linear == 0.0
    for i in range(40, 80):
        feed(c, i * 0.05, scan_min=0.3)
        c.on_cmd('nav', -0.2, 0.0, i * 0.05)
        o = c.step(i * 0.05)
    assert o.linear == 0.0  # 360-degree scan: rear is also blocked
    c.on_scan([5.0] * 180 + [0.3] * 180, -math.pi, 2 * math.pi / 360, 0.1, 12.0)  # obstacle only on left half
    o = c.step(4.05)
    assert o.state == NORMAL


def test_stale_command_decays_to_zero():
    c = running()
    for i in range(1, 30):
        drive(c, i * 0.05)
    for i in range(30, 60):
        feed(c, i * 0.05)
        o = c.step(i * 0.05)
    assert o.linear == 0.0 and o.state == NORMAL


def test_soft_stop_request_ramps_down_and_is_not_latched():
    c = running()
    for i in range(1, 30):
        drive(c, i * 0.05)
    c.on_stop_request(True)
    o = drive(c, 1.5)
    assert o.state == STOPPING and not o.latched and 0 < o.linear < 0.5
    for i in range(31, 60):
        o = drive(c, i * 0.05)
    assert o.linear == 0.0
    c.on_stop_request(False)
    assert drive(c, 3.05).state == NORMAL


def test_warning_fault_degrades_speed():
    c = running()
    c.on_fault_event('LEFT_WHEEL_RESPONSE_MISMATCH', 'warning', True)
    for i in range(1, 60):
        o = drive(c, i * 0.05, v=5.0)
    assert o.state == DEGRADED and abs(o.linear - 0.25) < 1e-9
