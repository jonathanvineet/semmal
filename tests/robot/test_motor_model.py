from semmal_base.motor_model import MotorModel, MotorModelConfig, wheel_speeds


def test_normal_operation_stays_below_fault_thresholds():
    m = MotorModel(MotorModelConfig())
    for _ in range(100000):  # 2000 s at full speed with tracking error
        cur, temp = m.update(10.0, 8.0, 0.02)
    assert cur < 6.0 and temp < 90.0


def test_wheel_speeds():
    l, r = wheel_speeds(0.3, 0.0, 0.36, 0.06)
    assert abs(l - 5.0) < 1e-9 and abs(r - 5.0) < 1e-9
    l, r = wheel_speeds(0.0, 1.0, 0.36, 0.06)
    assert l < 0 < r
