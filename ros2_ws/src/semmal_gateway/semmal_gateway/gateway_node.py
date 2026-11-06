"""Robot-host gateway node: the only bridge between the ROS 2 stack and the robot master agent.

- Writes $SEMMAL_STATE_FILE once a second (safety state, battery, coarse zone, availability,
  executor ready). services/robot-master relays it to the platform; it never sees raw topics.
- Serves a small HTTP API on 127.0.0.1 only (default port 8765):
    GET  /state                 the same document as the state file
    POST /mission              start ExecuteMission with allowlisted waypoint names
    GET  /mission              current phase and the last result (incl. local keyframe paths)
    POST /mission/cancel       cancel the active goal
    POST /hold                 {"hold": true|false} -> /safety/stop_request (soft, non-latching ramp)
    GET  /keyframe?path=...    one saved keyframe as a small PNG data URL (keyframe dir only)
  No topic passthrough, no velocity commands, no safety overrides. Recovery stays an operator
  service on /safety/request_recovery.
HTTP handlers never touch rclpy: they queue work that a 20 Hz timer runs on the executor thread.
"""
import json
import os
import queue
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import rclpy
import yaml
from rclpy.action import ActionClient
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy
from semmal_interfaces.action import ExecuteMission
from semmal_interfaces.msg import RobotState, SafetyState
from std_msgs.msg import Bool, String

from .core import keyframe_data_url, safe_keyframe_path, state_doc, validate_mission, write_atomic


class GatewayNode(Node):
    def __init__(self):
        super().__init__('semmal_gateway')
        data = os.environ.get('SEMMAL_DATA_DIR', os.path.expanduser('~/.semmal'))
        self.port = int(self.declare_parameter('port', 8765).value)
        self.state_file = self.declare_parameter('state_file', os.environ.get('SEMMAL_STATE_FILE', '/tmp/semmal-robot-state.json')).value
        self.keyframe_dir = self.declare_parameter('keyframe_dir', os.path.join(data, 'robot', 'keyframes')).value
        wp_file = self.declare_parameter('waypoints_file', '').value
        self.waypoints = {}
        self.world = os.path.splitext(os.path.basename(wp_file))[0] if wp_file else None
        if wp_file:
            with open(wp_file) as f:
                self.waypoints = (yaml.safe_load(f) or {}).get('waypoints', {}) or {}

        latched = QoSProfile(depth=1, reliability=ReliabilityPolicy.RELIABLE, durability=DurabilityPolicy.TRANSIENT_LOCAL)
        self.safety = None
        self.robot = None
        self.mission = {'phase': 'IDLE'}
        self.result = None
        self.goal_handle = None
        self.hold = False
        self.create_subscription(SafetyState, '/safety/state', lambda m: setattr(self, 'safety', m), latched)
        self.create_subscription(RobotState, '/robot/state', lambda m: setattr(self, 'robot', m), 10)
        self.create_subscription(String, '/mission/status', self._on_status, latched)
        self.stop_pub = self.create_publisher(Bool, '/safety/stop_request', latched)
        self.mission_client = ActionClient(self, ExecuteMission, '/mission/execute')

        self.work = queue.Queue()
        self.create_timer(0.05, self._drain)
        self.create_timer(1.0, self._write_state)
        self._serve()
        self.get_logger().info(f'gateway API on 127.0.0.1:{self.port}, state file {self.state_file}')

    # ---------------------------------------------------------------- state
    def _on_status(self, m):
        try:
            self.mission = json.loads(m.data)
        except ValueError:
            pass

    def state(self):
        r = self.robot
        return state_doc(
            safety_state=self.safety.state if self.safety else None,
            battery_pct=r.battery_percentage if r else None,
            x=r.x if r else None,
            y=r.y if r else None,
            waypoints=self.waypoints,
            mission_phase=self.mission.get('phase'),
            task_id=self.mission.get('task_id'),
            executor_ready=self.mission_client.server_is_ready(),
            hold=self.hold,
            world=self.world,
        )

    def _write_state(self):
        try:
            write_atomic(self.state_file, self.state())
        except OSError as e:
            self.get_logger().warn(f'state file: {e}')

    # ------------------------------------------------- work on the ROS thread
    def _drain(self):
        while True:
            try:
                fn, done = self.work.get_nowait()
            except queue.Empty:
                return
            try:
                done['value'] = fn()
            except Exception as e:  # report, never crash the node
                done['value'] = {'error': str(e)}
            done['event'].set()

    def run_on_ros(self, fn, timeout=5.0):
        done = {'event': threading.Event(), 'value': None}
        self.work.put((fn, done))
        if not done['event'].wait(timeout):
            return {'error': 'timed out waiting for the ROS thread'}
        return done['value']

    def start_mission(self, goal):
        if not self.mission_client.server_is_ready():
            return {'accepted': False, 'message': 'mission executor not available'}
        if self.goal_handle is not None:
            return {'accepted': False, 'message': 'a mission is already running'}
        g = ExecuteMission.Goal()
        g.task_id, g.episode_id, g.waypoints = goal['task_id'], goal['episode_id'], goal['waypoints']
        g.max_speed, g.dwell_s, g.capture_keyframe = goal['max_speed'], goal['dwell_s'], goal['capture_keyframe']
        self.result = None
        fut = self.mission_client.send_goal_async(g)
        fut.add_done_callback(self._on_goal)
        return {'accepted': True, 'message': 'goal sent'}

    def _on_goal(self, fut):
        handle = fut.result()
        if not handle.accepted:
            self.result = {'success': False, 'outcome': 'REJECTED', 'message': 'executor rejected the goal', 'reached': [], 'keyframePaths': []}
            return
        self.goal_handle = handle
        handle.get_result_async().add_done_callback(self._on_result)

    def _on_result(self, fut):
        r = fut.result().result
        self.result = {'success': r.success, 'outcome': r.outcome, 'message': r.message,
                       'reached': list(r.reached), 'keyframePaths': list(r.keyframe_paths)}
        self.goal_handle = None

    def cancel(self):
        if self.goal_handle is None:
            return {'canceled': False, 'message': 'no active mission'}
        self.goal_handle.cancel_goal_async()
        return {'canceled': True}

    def set_hold(self, hold):
        self.hold = bool(hold)
        self.stop_pub.publish(Bool(data=self.hold))
        return {'hold': self.hold}

    # ----------------------------------------------------------------- http
    def _serve(self):
        node = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def _send(self, code, doc):
                body = json.dumps(doc).encode()
                self.send_response(code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def _body(self):
                n = int(self.headers.get('Content-Length') or 0)
                if n > 16 * 1024:
                    return None
                try:
                    return json.loads(self.rfile.read(n) or b'{}')
                except ValueError:
                    return None

            def do_GET(self):
                u = urlparse(self.path)
                if u.path == '/state':
                    return self._send(200, node.state())
                if u.path == '/mission':
                    return self._send(200, {'status': node.mission, 'result': node.result, 'active': node.goal_handle is not None})
                if u.path == '/keyframe':
                    p = safe_keyframe_path((parse_qs(u.query).get('path') or [''])[0], node.keyframe_dir)
                    if not p:
                        return self._send(404, {'error': 'no such keyframe'})
                    return self._send(200, keyframe_data_url(p))
                return self._send(404, {'error': 'not found'})

            def do_POST(self):
                u = urlparse(self.path)
                body = self._body()
                if body is None:
                    return self._send(400, {'error': 'bad JSON body'})
                if u.path == '/mission':
                    goal, err = validate_mission(body, node.waypoints)
                    if err:
                        return self._send(400, {'error': err})
                    r = node.run_on_ros(lambda: node.start_mission(goal))
                    return self._send(200 if r.get('accepted') else 409, r)
                if u.path == '/mission/cancel':
                    return self._send(200, node.run_on_ros(node.cancel))
                if u.path == '/hold':
                    return self._send(200, node.run_on_ros(lambda: node.set_hold(body.get('hold', True))))
                return self._send(404, {'error': 'not found'})

        self.http = ThreadingHTTPServer(('127.0.0.1', self.port), Handler)
        threading.Thread(target=self.http.serve_forever, daemon=True).start()


def main():
    rclpy.init()
    node = GatewayNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.http.shutdown()
        node.destroy_node()
        rclpy.try_shutdown()
