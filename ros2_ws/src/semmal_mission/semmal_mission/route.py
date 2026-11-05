"""Route graph over named waypoints (no ROS). Loaded from semmal_navigation/config/waypoints.yaml."""
import heapq
import math

import yaml


class RouteError(ValueError):
    pass


class RouteGraph:
    def __init__(self, data):
        self.frame = data.get('frame', 'map')
        self.robot_radius = float(data.get('robot_radius', 0.3))
        g = data.get('geofence') or {}
        self.geofence = (g.get('min_x', -math.inf), g.get('min_y', -math.inf),
                         g.get('max_x', math.inf), g.get('max_y', math.inf))
        self.waypoints = {k: (float(v['x']), float(v['y']), float(v.get('yaw', 0.0)))
                          for k, v in (data.get('waypoints') or {}).items()}
        self.points = {k: (v[0], v[1]) for k, v in self.waypoints.items()}
        for k, v in (data.get('nodes') or {}).items():
            if k in self.points:
                raise RouteError(f'duplicate node name {k}')
            self.points[k] = (float(v['x']), float(v['y']))
        self.adj = {k: [] for k in self.points}
        self.edges = []
        for a, b in data.get('edges') or []:
            if a not in self.points or b not in self.points:
                raise RouteError(f'edge {a}-{b} references unknown node')
            d = math.dist(self.points[a], self.points[b])
            self.adj[a].append((b, d))
            self.adj[b].append((a, d))
            self.edges.append((a, b))

    @classmethod
    def load(cls, path):
        with open(path, 'r', encoding='utf-8') as f:
            return cls(yaml.safe_load(f))

    def is_allowed(self, name):
        return name in self.waypoints

    def in_geofence(self, x, y):
        x0, y0, x1, y1 = self.geofence
        return x0 <= x <= x1 and y0 <= y <= y1

    def shortest(self, src, dst):
        dist = {src: 0.0}
        prev = {}
        pq = [(0.0, src)]
        while pq:
            d, u = heapq.heappop(pq)
            if u == dst:
                break
            if d > dist.get(u, math.inf):
                continue
            for v, w in self.adj[u]:
                nd = d + w
                if nd < dist.get(v, math.inf):
                    dist[v], prev[v] = nd, u
                    heapq.heappush(pq, (nd, v))
        if dst not in dist:
            raise RouteError(f'no route {src} -> {dst}')
        path = [dst]
        while path[-1] != src:
            path.append(prev[path[-1]])
        return list(reversed(path)), dist[dst]

    @staticmethod
    def _project(p, a, b):
        ax, ay = a
        bx, by = b
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L2))
        q = (ax + t * dx, ay + t * dy)
        return q, math.dist(p, q)

    def plan(self, start_xy, goal):
        """Return list of (x, y, name) points from the robot's position to the named goal.

        The robot first joins the nearest graph edge (its projection), then follows the graph.
        """
        if not self.is_allowed(goal):
            raise RouteError(f'waypoint {goal!r} is not in the allowlist')
        if not self.edges:
            raise RouteError('route graph has no edges')
        best = None
        for a, b in self.edges:
            q, d = self._project(start_xy, self.points[a], self.points[b])
            if best is None or d < best[1]:
                best = (q, d, a, b)
        q, _d, a, b = best
        options = []
        for end in (a, b):
            path, length = self.shortest(end, goal)
            options.append((math.dist(q, self.points[end]) + length, path))
        _, path = min(options, key=lambda o: o[0])
        pts = []
        if math.dist(start_xy, q) > 0.05:
            pts.append((q[0], q[1], '_join'))
        for n in path:
            x, y = self.points[n]
            if pts and math.dist((pts[-1][0], pts[-1][1]), (x, y)) < 0.05:
                pts[-1] = (x, y, n)
            elif not pts and math.dist(start_xy, (x, y)) < 0.05 and n != goal:
                continue
            else:
                pts.append((x, y, n))
        if not pts or pts[-1][2] != goal:
            pts.append((*self.points[goal], goal))
        return pts
