"""Go-to-point controller for route following (no ROS). Output goes to /cmd_vel_nav and is
always re-limited by safety_supervisor; this controller is not a safety function."""
import math
from dataclasses import dataclass


def wrap(a):
    return math.atan2(math.sin(a), math.cos(a))


@dataclass
class ControllerConfig:
    max_speed: float = 0.4
    max_angular: float = 1.2
    k_dist: float = 0.8
    k_heading: float = 2.0
    rotate_in_place_threshold: float = 0.45   # rad
    pass_tolerance: float = 0.25              # m, intermediate points
    goal_tolerance: float = 0.10              # m, final point
    yaw_tolerance: float = 0.06               # rad


def go_to(pose, target, final, cfg: ControllerConfig, max_speed=None):
    """pose=(x,y,yaw), target=(x,y). Returns (v, w, reached: bool, distance)."""
    vmax = min(cfg.max_speed, max_speed) if max_speed else cfg.max_speed
    dx, dy = target[0] - pose[0], target[1] - pose[1]
    dist = math.hypot(dx, dy)
    tol = cfg.goal_tolerance if final else cfg.pass_tolerance
    if dist <= tol:
        return 0.0, 0.0, True, dist
    err = wrap(math.atan2(dy, dx) - pose[2])
    w = max(-cfg.max_angular, min(cfg.max_angular, cfg.k_heading * err))
    if abs(err) > cfg.rotate_in_place_threshold:
        return 0.0, w, False, dist
    v = min(vmax, cfg.k_dist * dist) * math.cos(err)
    if not final:
        v = max(v, min(vmax, 0.15))  # keep moving through intermediate points
    return v, w, False, dist


def align(pose, yaw, cfg: ControllerConfig):
    err = wrap(yaw - pose[2])
    if abs(err) <= cfg.yaw_tolerance:
        return 0.0, True
    w = max(-cfg.max_angular, min(cfg.max_angular, cfg.k_heading * err))
    if abs(w) < 0.15:
        w = math.copysign(0.15, w)
    return w, False
