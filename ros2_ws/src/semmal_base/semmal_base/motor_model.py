"""First-order DC motor current/thermal model for the Gazebo plant. No ROS.

This is a plant model for simulation, not a hardware driver. Its constants are illustrative
simulation values and must never be used as real hardware thresholds.
"""
from dataclasses import dataclass


@dataclass
class MotorModelConfig:
    idle_current_a: float = 0.25        # electronics + friction at standstill
    speed_current_a_per_rad_s: float = 0.06
    tracking_current_a_per_rad_s: float = 0.25  # extra current while accelerating / loaded
    max_current_a: float = 4.0          # driver current limit in normal operation
    ambient_c: float = 25.0
    thermal_rise_c_per_a2: float = 1.5  # steady-state rise = k * I^2
    thermal_tau_s: float = 60.0


class MotorModel:
    def __init__(self, cfg: MotorModelConfig):
        self.cfg = cfg
        self.current_a = cfg.idle_current_a
        self.temperature_c = cfg.ambient_c

    def update(self, commanded_rad_s, measured_rad_s, dt):
        c = self.cfg
        i = (c.idle_current_a + c.speed_current_a_per_rad_s * abs(measured_rad_s)
             + c.tracking_current_a_per_rad_s * abs(commanded_rad_s - measured_rad_s))
        self.current_a = min(i, c.max_current_a)
        target = c.ambient_c + c.thermal_rise_c_per_a2 * self.current_a ** 2
        if dt > 0:
            alpha = min(1.0, dt / c.thermal_tau_s)
            self.temperature_c += (target - self.temperature_c) * alpha
        return self.current_a, self.temperature_c


def wheel_speeds(linear, angular, wheel_separation, wheel_radius):
    """Differential-drive inverse kinematics -> (left, right) wheel rad/s."""
    left = (linear - angular * wheel_separation / 2.0) / wheel_radius
    right = (linear + angular * wheel_separation / 2.0) / wheel_radius
    return left, right
