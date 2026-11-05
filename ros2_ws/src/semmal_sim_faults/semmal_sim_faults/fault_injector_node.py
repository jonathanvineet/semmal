"""fault_injector: SIMULATION ONLY. Applies scripted motor/encoder faults to the Gazebo plant model.

Refuses to start unless the environment variable APP_MODE == "simulation" and
SIM_FAULT_INJECTION_ENABLED is not "false". It publishes only /sim/motor_fault_overlay,
which only motor_sim_node (a simulation plant node) consumes; it never publishes sensor topics.

Services: /sim/fault_inject (InjectFault), /sim/fault_clear (std_srvs/Trigger)
"""
import os
import sys
import uuid

import rclpy
from ament_index_python.packages import get_package_share_directory
from rclpy.clock import Clock, ClockType
from rclpy.executors import ExternalShutdownException
from rclpy.node import Node

from std_srvs.srv import Trigger
from semmal_interfaces.msg import FaultOverlay
from semmal_interfaces.srv import InjectFault

from .scenarios import load_dir, simulation_allowed


class FaultInjector(Node):
    def __init__(self):
        super().__init__('fault_injector')
        default_dir = os.path.join(get_package_share_directory('semmal_sim_faults'), 'scenarios')
        sdir = self.declare_parameter('scenario_dir', default_dir).value
        self.scenarios = load_dir(sdir)
        self.steady = Clock(clock_type=ClockType.STEADY_TIME)
        self.active = None          # (scenario, injection_id, end_time)
        self.pub = self.create_publisher(FaultOverlay, '/sim/motor_fault_overlay', 10)
        self.create_service(InjectFault, '/sim/fault_inject', self._inject)
        self.create_service(Trigger, '/sim/fault_clear', self._clear)
        self.create_timer(0.02, self._tick, clock=self.steady)
        self.get_logger().warn(f'SIMULATION fault injector ready; scenarios: {", ".join(self.scenarios)}')

    def _now(self):
        return self.steady.now().nanoseconds * 1e-9

    def _inject(self, req, res):
        s = self.scenarios.get(req.scenario_id)
        if s is None:
            res.accepted, res.message = False, f'unknown scenario {req.scenario_id!r}'
            return res
        if self.active is not None:
            res.accepted, res.message = False, f'scenario {self.active[0]["scenario_id"]} already active'
            return res
        iid = str(uuid.uuid4())
        self.active = (s, iid, self._now() + s['duration_ms'] / 1000.0)
        self.get_logger().warn(f'SIM INJECT {s["scenario_id"]} ({iid}) for {s["duration_ms"]} ms')
        res.accepted, res.message, res.injection_id = True, 'injected', iid
        self._tick()
        return res

    def _clear(self, _req, res):
        if self.active is None:
            res.success, res.message = False, 'no active scenario'
            return res
        self._end()
        res.success, res.message = True, 'cleared'
        return res

    def _msg(self, s, iid, active):
        m = FaultOverlay()
        m.header.stamp = self.get_clock().now().to_msg()
        m.injection_id, m.scenario_id, m.active, m.motor = iid, s['scenario_id'], active, s['motor']
        m.override_current = s['current_a'] is not None
        m.current_a = float(s['current_a'] or 0.0)
        m.override_temperature = s['temperature_c'] is not None
        m.temperature_c = float(s['temperature_c'] or 0.0)
        m.encoder_stale = s['encoder_stale']
        return m

    def _end(self):
        s, iid, _ = self.active
        self.active = None
        for _ in range(3):
            self.pub.publish(self._msg(s, iid, False))
        self.get_logger().warn(f'SIM scenario {s["scenario_id"]} ended')

    def _tick(self):
        if self.active is None:
            return
        s, iid, end = self.active
        if self._now() >= end:
            self._end()
        else:
            self.pub.publish(self._msg(s, iid, True))


def main():
    if not simulation_allowed():
        print('fault_injector: refusing to start: APP_MODE must be "simulation" '
              'and SIM_FAULT_INJECTION_ENABLED must not be "false".', file=sys.stderr)
        sys.exit(2)
    rclpy.init()
    node = FaultInjector()
    try:
        rclpy.spin(node)
    except (KeyboardInterrupt, ExternalShutdownException):
        pass
    finally:
        node.destroy_node()
        rclpy.try_shutdown()
