"""Deterministic safety supervisor core. No ROS, no network, no AI.

The ROS node feeds inputs in and publishes whatever `step()` returns. All times are
monotonic seconds supplied by the caller (the node uses a steady clock so a stalled
/clock or a paused simulator can never freeze the interlock logic).

States: NORMAL, DEGRADED, STOPPING, E_STOP, RECOVERY_REQUIRED.
  * critical fault, e-stop pressed, heartbeat loss, geofence breach -> E_STOP (latched, hard zero)
  * E_STOP with all critical conditions gone                         -> RECOVERY_REQUIRED (still latched)
  * RECOVERY_REQUIRED + explicit operator approval                    -> NORMAL
  * soft stop request (e.g. WAITING_FOR_0G hold)                       -> STOPPING (ramped zero, not latched)
  * warning-level faults or missing initial sensors                    -> DEGRADED
Nothing but request_recovery() with operator approval clears a latch.
"""
import math
from dataclasses import dataclass, field

NORMAL = 'NORMAL'
DEGRADED = 'DEGRADED'
STOPPING = 'STOPPING'
E_STOP = 'E_STOP'
RECOVERY_REQUIRED = 'RECOVERY_REQUIRED'
LATCHED_STATES = (E_STOP, RECOVERY_REQUIRED)

CRITICAL = 'critical'
WARNING = 'warning'


@dataclass
class SafetyConfig:
    max_linear: float = 0.5            # m/s
    max_angular: float = 1.5           # rad/s
    max_linear_accel: float = 0.8      # m/s^2
    max_angular_accel: float = 3.0     # rad/s^2
    stopping_decel: float = 1.5        # m/s^2 for the STOPPING ramp
    degraded_scale: float = 0.5        # speed multiplier in DEGRADED
    stop_distance: float = 0.35        # m, from lidar to obstacle, forward/backward sector
    slow_distance: float = 0.9         # m, linear scaling starts here
    sector_half_angle: float = 0.6     # rad, half-width of the front/rear sectors
    footprint_offset: float = 0.0      # m, subtracted from ranges (lidar-to-bumper)
    cmd_timeout: float = 0.5           # s, input velocity older than this is ignored
    heartbeat_timeouts: dict = field(default_factory=lambda: {
        'scan': 1.0, 'odom': 0.5, 'wheel_encoders': 0.5, 'motor_diagnostics': 0.5})
    startup_grace: float = 30.0        # s to wait for first heartbeats before E_STOP
    geofence: tuple = (-9.7, -6.7, 9.7, 6.7)  # min_x, min_y, max_x, max_y in map frame


@dataclass
class Output:
    linear: float
    angular: float
    state: str
    reason: str
    active_fault_codes: list
    motion_permitted: bool
    latched: bool
    transition_seq: int
    last_transition: float
    new_internal_faults: list  # [(code, active, message)] raised/cleared by the supervisor itself


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


def _approach(cur, target, max_delta):
    if target > cur:
        return min(target, cur + max_delta)
    return max(target, cur - max_delta)


class SafetyCore:
    def __init__(self, cfg: SafetyConfig, now: float):
        self.cfg = cfg
        self.t0 = now
        self.state = DEGRADED
        self.reason = 'waiting for sensors'
        self.transition_seq = 0
        self.last_transition = now
        self.external_faults = {}   # code -> severity (from diagnostics)
        self.internal_faults = {}   # code -> message (heartbeat, geofence, e-stop)
        self._pending_internal = []
        self.estop_pressed = False
        self.stop_requested = False
        self.heartbeats = {k: None for k in cfg.heartbeat_timeouts}
        self.pose = None
        self.front_min = math.inf
        self.rear_min = math.inf
        self.cmds = {}              # source -> (v, w, t)
        self.out_v = 0.0
        self.out_w = 0.0
        self.last_step = now

    # ------------------------------------------------------------------ inputs
    def on_fault_event(self, code, severity, active):
        if active:
            self.external_faults[code] = severity
        else:
            self.external_faults.pop(code, None)

    def on_estop(self, pressed: bool):
        self.estop_pressed = bool(pressed)

    def on_stop_request(self, requested: bool):
        self.stop_requested = bool(requested)

    def on_heartbeat(self, name, now):
        if name in self.heartbeats:
            self.heartbeats[name] = now

    def on_pose(self, x, y):
        self.pose = (x, y)

    def on_scan(self, ranges, angle_min, angle_increment, range_min, range_max):
        half = self.cfg.sector_half_angle
        front, rear = math.inf, math.inf
        for i, r in enumerate(ranges):
            if not math.isfinite(r) or r < range_min or r > range_max:
                continue
            a = math.atan2(math.sin(angle_min + i * angle_increment), math.cos(angle_min + i * angle_increment))
            d = r - self.cfg.footprint_offset
            if abs(a) <= half:
                front = min(front, d)
            elif abs(abs(a) - math.pi) <= half:
                rear = min(rear, d)
        self.front_min, self.rear_min = front, rear

    def on_cmd(self, source, v, w, now):
        self.cmds[source] = (float(v), float(w), now)

    # --------------------------------------------------------------- recovery
    def request_recovery(self, operator_id: str, approved: bool, now: float):
        if self.state != RECOVERY_REQUIRED:
            if self.state == E_STOP:
                return False, 'critical condition still active: ' + ', '.join(self.active_codes())
            return False, f'no latch to recover from (state {self.state})'
        if not approved or not operator_id:
            return False, 'explicit operator approval and operator_id are required'
        if self._critical_active():
            return False, 'critical condition active: ' + ', '.join(self.active_codes())
        self._transition(NORMAL, f'recovery approved by {operator_id}', now)
        self.out_v = self.out_w = 0.0
        # Drop any velocity input that predates the recovery: motion must be re-commanded.
        self.cmds.clear()
        return True, 'recovered to NORMAL'

    # ------------------------------------------------------------------- step
    def active_codes(self):
        return sorted(set(self.external_faults) | set(self.internal_faults))

    def _critical_active(self):
        return self.estop_pressed or bool(self.internal_faults) or any(
            s == CRITICAL for s in self.external_faults.values())

    def _set_internal(self, code, active, message=''):
        if active and code not in self.internal_faults:
            self.internal_faults[code] = message
            self._pending_internal.append((code, True, message))
        elif not active and code in self.internal_faults:
            del self.internal_faults[code]
            self._pending_internal.append((code, False, message))

    def _transition(self, state, reason, now):
        if state != self.state:
            self.state = state
            self.transition_seq += 1
            self.last_transition = now
        self.reason = reason

    def _evaluate_conditions(self, now):
        cfg = self.cfg
        self._set_internal('EMERGENCY_STOP_PRESSED', self.estop_pressed, 'emergency stop input pressed')
        waiting = []
        for name, timeout in cfg.heartbeat_timeouts.items():
            last = self.heartbeats[name]
            code = f'HEARTBEAT_LOSS_{name.upper()}'
            if last is None:
                waiting.append(name)
                self._set_internal(code, now - self.t0 > cfg.startup_grace,
                                   f'{name} never received within startup grace')
            else:
                self._set_internal(code, now - last > timeout, f'{name} stale > {timeout}s')
        if self.pose is not None:
            x, y = self.pose
            gx0, gy0, gx1, gy1 = cfg.geofence
            self._set_internal('GEOFENCE_VIOLATION', not (gx0 <= x <= gx1 and gy0 <= y <= gy1),
                               f'pose ({x:.2f},{y:.2f}) outside geofence')
        return waiting

    def step(self, now) -> Output:
        cfg = self.cfg
        dt = max(0.0, now - self.last_step)
        self.last_step = now
        waiting = self._evaluate_conditions(now)
        critical = self._critical_active()

        # ---- state transitions
        if critical:
            if self.state != E_STOP:
                self._transition(E_STOP, 'critical: ' + ', '.join(self.active_codes()), now)
            else:
                self.reason = 'critical: ' + ', '.join(self.active_codes())
        elif self.state == E_STOP:
            self._transition(RECOVERY_REQUIRED, 'critical conditions cleared; operator approval required', now)
        elif self.state == RECOVERY_REQUIRED:
            pass  # latched until request_recovery()
        elif self.stop_requested:
            self._transition(STOPPING, 'stop requested', now)
        elif waiting:
            self._transition(DEGRADED, 'waiting for sensors: ' + ', '.join(waiting), now)
        elif any(s != CRITICAL for s in self.external_faults.values()):
            self._transition(DEGRADED, 'warning: ' + ', '.join(sorted(self.external_faults)), now)
        else:
            self._transition(NORMAL, 'all checks nominal', now)

        latched = self.state in LATCHED_STATES
        motion_permitted = self.state in (NORMAL, DEGRADED) and not waiting

        # ---- output velocity
        if latched:
            v = w = 0.0                     # hard stop, no ramp
            self.out_v = self.out_w = 0.0
        elif not motion_permitted:
            decel = cfg.stopping_decel * dt
            self.out_v = _approach(self.out_v, 0.0, decel)
            self.out_w = _approach(self.out_w, 0.0, cfg.max_angular_accel * dt)
            v, w = self.out_v, self.out_w
        else:
            tv, tw = self._select_cmd(now)
            scale = cfg.degraded_scale if self.state == DEGRADED else 1.0
            tv = _clamp(tv, -cfg.max_linear * scale, cfg.max_linear * scale)
            tw = _clamp(tw, -cfg.max_angular * scale, cfg.max_angular * scale)
            tv = self._obstacle_limit(tv)
            self.out_v = _approach(self.out_v, tv, cfg.max_linear_accel * dt)
            self.out_w = _approach(self.out_w, tw, cfg.max_angular_accel * dt)
            # Obstacle limit applies to the ramped value too: never ramp into an obstacle.
            self.out_v = self._obstacle_limit(self.out_v)
            v, w = self.out_v, self.out_w

        internal, self._pending_internal = self._pending_internal, []
        return Output(v, w, self.state, self.reason, self.active_codes(), motion_permitted,
                      latched, self.transition_seq, self.last_transition, internal)

    def _select_cmd(self, now):
        for source in ('teleop', 'nav'):  # teleop has priority when fresh
            c = self.cmds.get(source)
            if c and now - c[2] <= self.cfg.cmd_timeout:
                return c[0], c[1]
        return 0.0, 0.0

    def _obstacle_limit(self, v):
        cfg = self.cfg
        d = self.front_min if v > 0 else self.rear_min if v < 0 else math.inf
        if d <= cfg.stop_distance:
            return 0.0
        if d < cfg.slow_distance:
            f = (d - cfg.stop_distance) / (cfg.slow_distance - cfg.stop_distance)
            return v * f
        return v
