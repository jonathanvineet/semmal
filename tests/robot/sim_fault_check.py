#!/usr/bin/env python3
"""Live-simulation fault check (CLAUDE.md §8.7). Run against a running `scripts/robot/run_sim.sh`.

  python3 tests/robot/sim_fault_check.py [--scenario left_motor_overcurrent] [--goal destination]

Steps: start a mission -> wait until the robot is moving -> inject the fault -> assert:
  1. fault event raised within the detection deadline,
  2. safety state E_STOP (latched) and /cmd_vel exactly zero,
  3. the mission is aborted (ABORTED_SAFETY),
  4. the incident is durable in the local SQLite spool with a sequence number,
  5. after the fault clears: RECOVERY_REQUIRED, still zero velocity, robot does not move,
  6. recovery without approval is rejected; with approval it returns to NORMAL.
No network, AI, Arkiv or Storage is involved anywhere in this path.
Exit code 0 = all assertions passed.
"""
import argparse
import json
import math
import os
import sys
import threading
import time

import rclpy
from rclpy.action import ActionClient
from rclpy.executors import MultiThreadedExecutor
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy

from geometry_msgs.msg import Twist
from nav_msgs.msg import Odometry
from std_msgs.msg import String
from semmal_interfaces.action import ExecuteMission
from semmal_interfaces.msg import FaultEvent, SafetyState
from semmal_interfaces.srv import InjectFault, RequestRecovery

# Deadlines = configured detection window (semmal_bringup/config/semmal.yaml) + 0.3 s scheduling margin.
MARGIN_S = 0.3
SCENARIOS = {
    'left_motor_overcurrent': ('LEFT_MOTOR_OVERCURRENT', 0.2),  # diagnostics debounce_s
    'left_encoder_dropout': ('LEFT_ENCODER_STALE', 0.5),        # diagnostics encoder_stale_s
}


class Checker(Node):
    def __init__(self):
        super().__init__('sim_fault_check')
        latched = QoSProfile(depth=1, reliability=ReliabilityPolicy.RELIABLE,
                             durability=DurabilityPolicy.TRANSIENT_LOCAL)
        reliable = QoSProfile(depth=50, reliability=ReliabilityPolicy.RELIABLE)
        self.safety = None
        self.safety_log = []
        self.faults = []
        self.incidents = []
        self.cmd = None
        self.cmd_log = []
        self.speed = 0.0
        self.pose = None
        self.create_subscription(SafetyState, '/safety/state', self._safety, latched)
        self.create_subscription(FaultEvent, '/fault_events', lambda m: self.faults.append((time.monotonic(), m)), reliable)
        self.create_subscription(String, '/incidents/recorded', lambda m: self.incidents.append(json.loads(m.data)), reliable)
        self.create_subscription(Twist, '/cmd_vel', self._cmd, 10)
        self.create_subscription(Odometry, '/odom', self._odom, 10)
        self.mission = ActionClient(self, ExecuteMission, '/mission/execute')
        self.inject = self.create_client(InjectFault, '/sim/fault_inject')
        self.recover = self.create_client(RequestRecovery, '/safety/request_recovery')

    def _safety(self, m):
        if self.safety is None or m.state != self.safety.state:
            self.safety_log.append((time.monotonic(), m.state))
        self.safety = m

    def _cmd(self, m):
        self.cmd = m
        self.cmd_log.append((time.monotonic(), m.linear.x, m.angular.z))

    def _odom(self, m):
        self.speed = math.hypot(m.twist.twist.linear.x, m.twist.twist.angular.z)
        self.pose = (m.pose.pose.position.x, m.pose.pose.position.y)


def wait(pred, timeout, step=0.02):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if pred():
            return True
        time.sleep(step)
    return pred()


def call(client, req, timeout=5.0):
    if not client.wait_for_service(timeout_sec=timeout):
        raise RuntimeError(f'service {client.srv_name} unavailable')
    fut = client.call_async(req)
    if not wait(fut.done, timeout):
        raise RuntimeError(f'service {client.srv_name} timed out')
    return fut.result()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--scenario', default='left_motor_overcurrent')
    ap.add_argument('--goal', default='destination')
    ap.add_argument('--expect-fault', default=None, help='fault code to expect (default from scenario)')
    a = ap.parse_args()
    expect, window = SCENARIOS[a.scenario]
    expect = a.expect_fault or expect
    DETECTION_DEADLINE_S = window + MARGIN_S
    STOP_DEADLINE_S = DETECTION_DEADLINE_S + 0.1  # supervisor reacts on the event, plus one tick

    rclpy.init()
    n = Checker()
    ex = MultiThreadedExecutor()
    ex.add_node(n)
    threading.Thread(target=ex.spin, daemon=True).start()
    results = []

    def check(name, ok, detail=''):
        results.append(ok)
        print(f'[{"PASS" if ok else "FAIL"}] {name}{": " + detail if detail else ""}', flush=True)
        return ok

    try:
        if not check('safety state NORMAL before test', wait(lambda: n.safety and n.safety.state == 'NORMAL', 10),
                     n.safety.state if n.safety else 'none'):
            return 1
        n.mission.wait_for_server(timeout_sec=10)
        goal = ExecuteMission.Goal(task_id='task-fault-check', episode_id='episode-fault-check',
                                   waypoints=[a.goal], max_speed=0.4, dwell_s=0.0, capture_keyframe=False)
        gfut = n.mission.send_goal_async(goal)
        wait(gfut.done, 5)
        gh = gfut.result()
        if not check('mission accepted', gh is not None and gh.accepted):
            return 1
        rfut = gh.get_result_async()
        check('robot moving before fault', wait(lambda: n.speed > 0.15, 30), f'speed {n.speed:.2f}')

        t_inj = time.monotonic()
        r = call(n.inject, InjectFault.Request(scenario_id=a.scenario))
        check('fault injected', r.accepted, r.message)

        def fault_seen():
            return any(m.fault_code == expect and m.active and t >= t_inj for t, m in n.faults)
        got = wait(fault_seen, 3)
        t_fault = next((t for t, m in n.faults if m.fault_code == expect and m.active and t >= t_inj), None)
        check(f'{expect} detected within {DETECTION_DEADLINE_S}s', got and t_fault - t_inj <= DETECTION_DEADLINE_S,
              f'{(t_fault - t_inj) * 1000:.0f} ms' if t_fault else 'not seen')

        stopped = wait(lambda: n.safety.state == 'E_STOP' and n.cmd is not None
                       and n.cmd.linear.x == 0.0 and n.cmd.angular.z == 0.0, 3)
        t_stop = next((t for t, s in n.safety_log if s == 'E_STOP' and t >= t_inj), None)
        check(f'E_STOP latched within {STOP_DEADLINE_S}s', stopped and n.safety.latched and t_stop is not None
              and t_stop - t_inj <= STOP_DEADLINE_S, f'{(t_stop - t_inj) * 1000:.0f} ms' if t_stop else n.safety.state)
        after = [c for c in n.cmd_log if t_stop and c[0] > t_stop + 0.06]
        time.sleep(0.5)
        after = [c for c in n.cmd_log if t_stop and c[0] > t_stop + 0.06]
        check('/cmd_vel exactly zero after E_STOP', bool(after) and all(v == 0.0 and w == 0.0 for _t, v, w in after),
              f'{len(after)} samples')

        wait(rfut.done, 5)
        res = rfut.result().result if rfut.done() else None
        check('mission aborted by safety', res is not None and res.outcome == 'ABORTED_SAFETY',
              f'{res.outcome}: {res.message}' if res else 'no result')

        wait(lambda: any(i['fault_code'] == expect and not i['duplicate'] for i in n.incidents), 3)
        inc = next((i for i in n.incidents if i['fault_code'] == expect and not i['duplicate']), None)
        check('incident durable in local spool', inc is not None and inc['stage'] == 'LOCAL_DURABLE'
              and inc['sequence_number'] >= 1, json.dumps(inc) if inc else 'none')
        if inc:
            sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'ros2_ws', 'src', 'semmal_incident'))
            from semmal_incident.spool import IncidentSpool
            from semmal_incident.incident_recorder_node import default_spool_path
            row = IncidentSpool(default_spool_path()).get(inc['incident_id'])
            m = json.loads(row['manifest_json']) if row else {}
            check('spool row readable with manifest', row is not None and m.get('task_id') == 'task-fault-check'
                  and m.get('safety_action') == 'EMERGENCY_STOP', f'seq {row["sequence_number"] if row else None}')

        r = call(n.recover, RequestRecovery.Request(operator_id='checker', operator_approved=True, reason='too early'))
        check('recovery rejected while fault active', not r.accepted, r.message)

        cleared = wait(lambda: n.safety.state == 'RECOVERY_REQUIRED', 15)
        check('fault cleared -> RECOVERY_REQUIRED (still latched)', cleared and n.safety.latched, n.safety.state)
        p0 = n.pose
        time.sleep(2.0)
        moved = math.dist(p0, n.pose) if p0 and n.pose else None
        check('no motion after sensor normalises', moved is not None and moved < 0.01 and n.cmd.linear.x == 0.0,
              f'moved {moved:.4f} m' if moved is not None else 'no pose')

        r = call(n.recover, RequestRecovery.Request(operator_id='', operator_approved=False, reason='no approval'))
        check('recovery without approval rejected', not r.accepted, r.message)
        r = call(n.recover, RequestRecovery.Request(operator_id='checker', operator_approved=True, reason='inspected'))
        check('recovery with operator approval accepted', r.accepted and r.state == 'NORMAL', r.message)
    finally:
        ok = all(results)
        print(f'\n{"ALL PASSED" if ok else "FAILURES"}: {sum(results)}/{len(results)}', flush=True)
        rclpy.try_shutdown()
    return 0 if all(results) else 1


if __name__ == '__main__':
    sys.exit(main())
