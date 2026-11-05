"""mission_executor: ExecuteMission action server (/mission/execute).

Accepts only named waypoints from the allowlist (waypoints.yaml), bounded speed/dwell, and only
when the safety state permits motion. Follows the route graph with a simple go-to-point
controller and publishes /cmd_vel_nav (never /cmd_vel: safety_supervisor owns that).
Aborts immediately if the safety state becomes STOPPING, E_STOP or RECOVERY_REQUIRED.
Keyframes are written to the robot host only; the executor never uploads anything.

Publishes /mission/status (std_msgs/String JSON, transient_local) for robot_state/incident nodes.
"""
import json
import math
import os
import threading
import time

import rclpy
from ament_index_python.packages import get_package_share_directory
from rclpy.action import ActionServer, CancelResponse, GoalResponse
from rclpy.callback_groups import ReentrantCallbackGroup
from rclpy.duration import Duration
from rclpy.executors import ExternalShutdownException, MultiThreadedExecutor
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy, qos_profile_sensor_data
from rclpy.time import Time

import tf2_ros
from geometry_msgs.msg import Twist
from sensor_msgs.msg import Image
from std_msgs.msg import String
from semmal_interfaces.action import ExecuteMission
from semmal_interfaces.msg import SafetyState

from .controller import ControllerConfig, align, go_to
from .route import RouteError, RouteGraph

UNSAFE = ('STOPPING', 'E_STOP', 'RECOVERY_REQUIRED')
MAX_WAYPOINTS = 10
MAX_DWELL_S = 60.0


def yaw_from_quat(q):
    return math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z))


class MissionExecutor(Node):
    def __init__(self):
        super().__init__('mission_executor')
        p = self.declare_parameter
        default_wp = os.path.join(get_package_share_directory('semmal_navigation'), 'config', 'waypoints', 'warehouse.yaml')
        self.graph = RouteGraph.load(p('waypoints_file', default_wp).value)
        self.cfg = ControllerConfig(max_speed=p('max_speed', 0.4).value,
                                    max_angular=p('max_angular', 1.2).value)
        self.robot_frame = p('robot_frame', 'base_footprint').value
        self.stuck_timeout = p('stuck_timeout_s', 20.0).value
        data = os.environ.get('SEMMAL_DATA_DIR') or os.path.join(
            os.environ.get('XDG_DATA_HOME', os.path.expanduser('~/.local/share')), 'semmal')
        self.keyframe_dir = p('keyframe_dir', os.path.join(data, 'robot', 'keyframes')).value

        self.safety = None
        self.image = None
        self.lock = threading.Lock()
        self.busy = False
        self.cb = ReentrantCallbackGroup()
        self.tf_buffer = tf2_ros.Buffer()
        self.tf_listener = tf2_ros.TransformListener(self.tf_buffer, self)

        latched = QoSProfile(depth=1, reliability=ReliabilityPolicy.RELIABLE,
                             durability=DurabilityPolicy.TRANSIENT_LOCAL)
        self.cmd_pub = self.create_publisher(Twist, '/cmd_vel_nav', 10)
        self.status_pub = self.create_publisher(String, '/mission/status', latched)
        self.create_subscription(SafetyState, '/safety/state', self._on_safety, latched, callback_group=self.cb)
        self.create_subscription(Image, '/camera/image_raw', self._on_image, qos_profile_sensor_data,
                                 callback_group=self.cb)
        self.server = ActionServer(self, ExecuteMission, '/mission/execute', execute_callback=self._execute,
                                   goal_callback=self._on_goal, cancel_callback=lambda _g: CancelResponse.ACCEPT,
                                   callback_group=self.cb)
        self._status('IDLE')
        self.get_logger().info(f'mission_executor ready; allowlist: {", ".join(self.graph.waypoints)}')

    # ----------------------------------------------------------------- inputs
    def _on_safety(self, m):
        self.safety = m

    def _on_image(self, m):
        self.image = m

    def _status(self, phase, goal=None, **extra):
        d = {'phase': phase, 'task_id': getattr(goal, 'task_id', None) or None,
             'episode_id': getattr(goal, 'episode_id', None) or None, **extra}
        self.status_pub.publish(String(data=json.dumps(d)))

    def pose(self):
        try:
            t = self.tf_buffer.lookup_transform(self.graph.frame, self.robot_frame, Time(),
                                                timeout=Duration(seconds=0.2))
        except (tf2_ros.LookupException, tf2_ros.ConnectivityException, tf2_ros.ExtrapolationException):
            return None
        tr = t.transform
        return tr.translation.x, tr.translation.y, yaw_from_quat(tr.rotation)

    # ----------------------------------------------------------- validation
    def validate(self, g):
        if not g.waypoints:
            return 'no waypoints'
        if len(g.waypoints) > MAX_WAYPOINTS:
            return f'too many waypoints (max {MAX_WAYPOINTS})'
        bad = [w for w in g.waypoints if not self.graph.is_allowed(w)]
        if bad:
            return f'waypoints not in allowlist: {bad}'
        if not (math.isfinite(g.max_speed) and 0.0 <= g.max_speed):
            return 'max_speed must be >= 0'
        if not (math.isfinite(g.dwell_s) and 0.0 <= g.dwell_s <= MAX_DWELL_S):
            return f'dwell_s must be in [0, {MAX_DWELL_S}]'
        s = self.safety
        if s is None:
            return 'no safety state received'
        if s.state in UNSAFE or not s.motion_permitted:
            return f'safety state {s.state} does not permit motion ({s.reason})'
        return None

    def _on_goal(self, g):
        with self.lock:
            if self.busy:
                self.get_logger().warn('rejecting goal: a mission is already running')
                return GoalResponse.REJECT
            err = self.validate(g)
            if err:
                self.get_logger().warn(f'rejecting goal: {err}')
                return GoalResponse.REJECT
            self.busy = True
        return GoalResponse.ACCEPT

    # -------------------------------------------------------------- execution
    def _stop(self):
        self.cmd_pub.publish(Twist())

    def _finish(self, handle, outcome, msg, reached, keyframes, success=False):
        self._stop()
        r = ExecuteMission.Result()
        r.success, r.outcome, r.message = success, outcome, msg
        r.reached, r.keyframe_paths = reached, keyframes
        if outcome == 'CANCELED':
            handle.canceled()
        elif success:
            handle.succeed()
        else:
            handle.abort()
        self._status(outcome, handle.request)
        self.get_logger().info(f'mission {outcome}: {msg}')
        with self.lock:
            self.busy = False
        return r

    def _execute(self, handle):
        g = handle.request
        reached, keyframes = [], []
        speed = g.max_speed if g.max_speed > 0 else None
        fb = ExecuteMission.Feedback()
        self.get_logger().info(f'mission start task={g.task_id} waypoints={list(g.waypoints)}')
        try:
            for idx, wp in enumerate(g.waypoints):
                pose = self._wait_pose()
                if pose is None:
                    return self._finish(handle, 'FAILED', 'no map->base pose (TF)', reached, keyframes)
                try:
                    pts = self.graph.plan((pose[0], pose[1]), wp)
                except RouteError as e:
                    return self._finish(handle, 'FAILED', str(e), reached, keyframes)
                self.get_logger().info(f'route to {wp}: {[n for _x, _y, n in pts]}')
                fb.current_waypoint, fb.waypoint_index, fb.phase = wp, idx, 'NAVIGATING'
                self._status('NAVIGATING', g, waypoint=wp)
                outcome = self._follow(handle, pts, speed, fb)
                if outcome:
                    return self._finish(handle, outcome[0], outcome[1], reached, keyframes)
                # final heading
                yaw = self.graph.waypoints[wp][2]
                while True:
                    o = self._check(handle)
                    if o:
                        return self._finish(handle, o[0], o[1], reached, keyframes)
                    pose = self.pose()
                    if pose is None:
                        self._stop()
                        time.sleep(0.05)
                        continue
                    w, done = align(pose, yaw, self.cfg)
                    if done:
                        break
                    t = Twist()
                    t.angular.z = w
                    self.cmd_pub.publish(t)
                    time.sleep(0.05)
                self._stop()
                reached.append(wp)
                if g.capture_keyframe:
                    fb.phase = 'CAPTURING'
                    handle.publish_feedback(fb)
                    path = self._capture(g, wp)
                    if path:
                        keyframes.append(path)
                if g.dwell_s > 0:
                    fb.phase = 'DWELLING'
                    handle.publish_feedback(fb)
                    self._status('DWELLING', g, waypoint=wp)
                    end = time.monotonic() + g.dwell_s
                    while time.monotonic() < end:
                        o = self._check(handle)
                        if o:
                            return self._finish(handle, o[0], o[1], reached, keyframes)
                        self._stop()
                        time.sleep(0.05)
            return self._finish(handle, 'COMPLETED', f'reached {reached}', reached, keyframes, success=True)
        except Exception as e:  # never leave the robot with a stale nav command
            self.get_logger().error(f'mission error: {e!r}')
            return self._finish(handle, 'FAILED', f'internal error: {e}', reached, keyframes)

    def _wait_pose(self, timeout=5.0):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            p = self.pose()
            if p is not None:
                return p
            time.sleep(0.1)
        return None

    def _check(self, handle):
        if handle.is_cancel_requested:
            return ('CANCELED', 'cancel requested')
        s = self.safety
        if s is None or s.state in UNSAFE or not s.motion_permitted:
            state = s.state if s else 'UNKNOWN'
            return ('ABORTED_SAFETY', f'safety state {state}: {s.reason if s else "no safety state"}')
        if not rclpy.ok():
            return ('FAILED', 'shutting down')
        return None

    def _follow(self, handle, pts, speed, fb):
        i = 0
        best, best_t = math.inf, time.monotonic()
        while i < len(pts):
            o = self._check(handle)
            if o:
                return o
            pose = self.pose()
            if pose is None:
                self._stop()
                time.sleep(0.05)
                continue
            x, y, _name = pts[i]
            final = i == len(pts) - 1
            v, w, done, dist = go_to(pose, (x, y), final, self.cfg, speed)
            if done:
                i += 1
                best, best_t = math.inf, time.monotonic()
                continue
            if dist < best - 0.05:
                best, best_t = dist, time.monotonic()
            elif time.monotonic() - best_t > self.stuck_timeout:
                return ('FAILED', f'no progress toward {_name} for {self.stuck_timeout}s')
            t = Twist()
            t.linear.x, t.angular.z = v, w
            self.cmd_pub.publish(t)
            remaining = dist + sum(math.dist(pts[k][:2], pts[k + 1][:2]) for k in range(i, len(pts) - 1))
            fb.distance_remaining = float(remaining)
            handle.publish_feedback(fb)
            time.sleep(0.05)
        self._stop()
        return None

    def _capture(self, g, wp, timeout=3.0):
        """Save one camera frame received after arrival as a binary PPM on the robot host."""
        arrived = self.get_clock().now()
        end = time.monotonic() + timeout
        img = None
        while time.monotonic() < end:
            m = self.image
            if m is not None and Time.from_msg(m.header.stamp) >= arrived:
                img = m
                break
            time.sleep(0.05)
        if img is None:
            self.get_logger().warn(f'no fresh camera frame at {wp}')
            return None
        if img.encoding not in ('rgb8', 'bgr8'):
            self.get_logger().warn(f'unsupported image encoding {img.encoding}')
            return None
        data = bytes(img.data)
        w, h, step = img.width, img.height, img.step
        rows = [data[r * step: r * step + w * 3] for r in range(h)]
        if img.encoding == 'bgr8':
            rows = [bytes(b for i in range(0, len(row), 3) for b in (row[i + 2], row[i + 1], row[i])) for row in rows]
        d = os.path.join(self.keyframe_dir, (g.task_id or 'no-task').replace('/', '_'))
        os.makedirs(d, exist_ok=True)
        path = os.path.join(d, f'{wp}_{img.header.stamp.sec}_{img.header.stamp.nanosec:09d}.ppm')
        with open(path, 'wb') as f:
            f.write(f'P6\n{w} {h}\n255\n'.encode())
            for row in rows:
                f.write(row)
        self.get_logger().info(f'keyframe saved locally: {path}')
        return path


def main():
    rclpy.init()
    node = MissionExecutor()
    ex = MultiThreadedExecutor(num_threads=4)
    ex.add_node(node)
    try:
        ex.spin()
    except (KeyboardInterrupt, ExternalShutdownException):
        pass
    finally:
        try:
            node._stop()
        except Exception:
            pass
        node.destroy_node()
        rclpy.try_shutdown()
