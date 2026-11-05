"""Deterministic fault detection rules. No ROS. Times are monotonic seconds from the caller.

Rules (per wheel unless noted):
  *_MOTOR_OVERCURRENT        current > overcurrent_a for debounce_s               critical
  *_MOTOR_OVERTEMPERATURE    temperature > overtemp_c for debounce_s              critical
  *_ENCODER_STALE            |commanded| > motion_eps and position unchanged for encoder_stale_s  critical
  *_WHEEL_RESPONSE_MISMATCH  |commanded - measured| > mismatch_tol for mismatch_s warning
  MOTOR_DIAGNOSTICS_WATCHDOG no motor diagnostics for watchdog_s (after first)    critical
  ENCODER_WATCHDOG           no encoder message for watchdog_s (after first)      critical
  BATTERY_LOW / BATTERY_CRITICAL  percentage below thresholds                     warning / critical
A raised fault clears only after its condition has been absent for clear_hold_s.
Clearing a fault never clears the safety latch; that is the supervisor's job.
"""
from dataclasses import dataclass

CRITICAL = 'critical'
WARNING = 'warning'


@dataclass
class DiagnosticsConfig:
    overcurrent_a: float = 6.0
    overtemp_c: float = 90.0
    debounce_s: float = 0.2
    clear_hold_s: float = 2.0
    encoder_stale_s: float = 0.5
    motion_eps: float = 0.5           # rad/s wheel speed considered "commanded motion"
    position_eps: float = 1e-4        # rad
    mismatch_tol: float = 3.0         # rad/s
    mismatch_s: float = 1.5
    watchdog_s: float = 0.5
    battery_low_pct: float = 15.0
    battery_critical_pct: float = 5.0


class Debounced:
    def __init__(self, raise_after, clear_after):
        self.raise_after, self.clear_after = raise_after, clear_after
        self.active = False
        self._since = None   # time the condition started differing from `active`

    def update(self, condition, now):
        """Return 'raised', 'cleared' or None."""
        if condition == self.active:
            self._since = None
            return None
        if self._since is None:
            self._since = now
        hold = self.raise_after if condition else self.clear_after
        if now - self._since >= hold:
            self.active, self._since = condition, None
            return 'raised' if condition else 'cleared'
        return None


class DiagnosticsCore:
    def __init__(self, cfg: DiagnosticsConfig):
        self.cfg = cfg
        c = cfg
        self.rules = {}  # code -> (Debounced, severity, component)
        for side in ('left', 'right'):
            S = side.upper()
            self._rule(f'{S}_MOTOR_OVERCURRENT', c.debounce_s, CRITICAL, f'{side}_motor')
            self._rule(f'{S}_MOTOR_OVERTEMPERATURE', c.debounce_s, CRITICAL, f'{side}_motor')
            self._rule(f'{S}_ENCODER_STALE', 0.0, CRITICAL, f'{side}_encoder')
            self._rule(f'{S}_WHEEL_RESPONSE_MISMATCH', c.mismatch_s, WARNING, f'{side}_drive')
        self._rule('MOTOR_DIAGNOSTICS_WATCHDOG', 0.0, CRITICAL, 'motor_driver')
        self._rule('ENCODER_WATCHDOG', 0.0, CRITICAL, 'encoders')
        self._rule('BATTERY_LOW', 0.0, WARNING, 'battery')
        self._rule('BATTERY_CRITICAL', 0.0, CRITICAL, 'battery')
        self.motor = None           # latest motor diagnostics dict
        self.motor_t = None
        self.enc_t = None
        self.enc_pos = {'left': None, 'right': None}
        self.enc_changed_t = {'left': None, 'right': None}
        self.moving_since = {'left': None, 'right': None}
        self.battery_pct = None

    def _rule(self, code, raise_after, severity, component):
        self.rules[code] = (Debounced(raise_after, self.cfg.clear_hold_s), severity, component)

    # inputs ---------------------------------------------------------------
    def on_motor(self, now, left_current_a, right_current_a, left_temperature_c, right_temperature_c,
                 left_commanded_rad_s, right_commanded_rad_s, left_measured_rad_s, right_measured_rad_s):
        self.motor = dict(left_current_a=left_current_a, right_current_a=right_current_a,
                          left_temperature_c=left_temperature_c, right_temperature_c=right_temperature_c,
                          left_commanded_rad_s=left_commanded_rad_s, right_commanded_rad_s=right_commanded_rad_s,
                          left_measured_rad_s=left_measured_rad_s, right_measured_rad_s=right_measured_rad_s)
        self.motor_t = now

    def on_encoders(self, now, left_pos, right_pos):
        self.enc_t = now
        for side, pos in (('left', left_pos), ('right', right_pos)):
            prev = self.enc_pos[side]
            if prev is None or abs(pos - prev) > self.cfg.position_eps:
                self.enc_pos[side] = pos
                self.enc_changed_t[side] = now

    def on_battery(self, pct):
        self.battery_pct = pct

    def summary(self):
        m = self.motor or {}
        return {
            'left_motor_current_a': m.get('left_current_a', 0.0),
            'left_motor_temperature_c': m.get('left_temperature_c', 0.0),
            'right_motor_current_a': m.get('right_current_a', 0.0),
            'right_motor_temperature_c': m.get('right_temperature_c', 0.0),
            'left_encoder_stale': self.rules['LEFT_ENCODER_STALE'][0].active,
            'right_encoder_stale': self.rules['RIGHT_ENCODER_STALE'][0].active,
        }

    def active_faults(self):
        return {code: sev for code, (d, sev, _c) in self.rules.items() if d.active}

    # evaluation -------------------------------------------------------------
    def step(self, now):
        """Return list of events: dicts with code, severity, active, component, message."""
        c = self.cfg
        conds = {}
        m = self.motor
        if m is not None:
            for side in ('left', 'right'):
                S = side.upper()
                cur, temp = m[f'{side}_current_a'], m[f'{side}_temperature_c']
                cmd, meas = m[f'{side}_commanded_rad_s'], m[f'{side}_measured_rad_s']
                conds[f'{S}_MOTOR_OVERCURRENT'] = (cur > c.overcurrent_a, f'{side} current {cur:.2f} A > {c.overcurrent_a} A')
                conds[f'{S}_MOTOR_OVERTEMPERATURE'] = (temp > c.overtemp_c, f'{side} temperature {temp:.1f} C > {c.overtemp_c} C')
                moving = abs(cmd) > c.motion_eps
                if moving and self.moving_since[side] is None:
                    self.moving_since[side] = now
                elif not moving:
                    self.moving_since[side] = None
                conds[f'{S}_WHEEL_RESPONSE_MISMATCH'] = (
                    moving and abs(cmd - meas) > c.mismatch_tol,
                    f'{side} wheel commanded {cmd:.2f} rad/s, measured {meas:.2f} rad/s')
                ct = self.enc_changed_t[side]
                ms = self.moving_since[side]
                if ct is not None and ms is not None:
                    # Stale only counts from when motion was commanded.
                    stale_for = now - max(ct, ms)
                    conds[f'{S}_ENCODER_STALE'] = (stale_for >= c.encoder_stale_s,
                                                   f'{side} encoder unchanged for {stale_for:.2f} s while moving')
                else:
                    conds[f'{S}_ENCODER_STALE'] = (False, '')
        if self.motor_t is not None:
            conds['MOTOR_DIAGNOSTICS_WATCHDOG'] = (now - self.motor_t > c.watchdog_s, 'motor diagnostics stale')
        if self.enc_t is not None:
            conds['ENCODER_WATCHDOG'] = (now - self.enc_t > c.watchdog_s, 'wheel encoders stale')
        if self.battery_pct is not None:
            conds['BATTERY_LOW'] = (self.battery_pct < c.battery_low_pct, f'battery {self.battery_pct:.1f}%')
            conds['BATTERY_CRITICAL'] = (self.battery_pct < c.battery_critical_pct, f'battery {self.battery_pct:.1f}%')

        events = []
        for code, (cond, msg) in conds.items():
            deb, sev, comp = self.rules[code]
            r = deb.update(cond, now)
            if r:
                events.append({'code': code, 'severity': sev, 'active': r == 'raised',
                               'component': comp, 'message': msg if r == 'raised' else f'{code} cleared'})
        return events
