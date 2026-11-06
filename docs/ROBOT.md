# Robot side (Track A): ROS 2 graph, simulation and safety

ROS 2 Jazzy + Gazebo Harmonic (gz-sim 8) on Ubuntu 24.04. Versions and evidence: `docs/FACT_CHECK.md`.

## Quick start

```bash
scripts/robot/check_env.sh                     # versions; fails clearly if something is missing
scripts/robot/build.sh                         # regenerate world/map from layout.yaml + colcon build
scripts/robot/fetch_models.sh                  # once, needs internet: Fuel furniture for the house world
scripts/robot/run_sim.sh world:=house          # Gazebo GUI + full robot stack (world:=warehouse is the default;
                                               #   add rviz:=true / headless:=true / follow:=false)
scripts/robot/gui.sh                           # reopen the Gazebo window (closing it never stops the robot);
                                               #   the camera follows the robot
(cd services/robot-master && pnpm run setup house)   # once per robot: hardware, wallet, platform, token
scripts/robot/scenario.sh house                    # that robot's hardware + its world (+ identity node)
(cd services/robot-master && pnpm start house)   # identity service + robot agent; see docs/SCENARIOS.md
scripts/robot/mission.sh inspection_point_A    # ExecuteMission goal (named waypoints only)
scripts/robot/mission.sh bathroom office bedroom guest_room living_room kitchen dock   # house tour
scripts/robot/inject_fault.sh left_motor_overcurrent   # SIMULATION ONLY
scripts/robot/recover.sh <operator_id> "reason"        # operator-approved recovery
scripts/robot/stop_sim.sh                      # stop launch + any orphaned gz server
ros2 run semmal_incident spool_status          # local incident spool
python3 -m pytest tests/robot                  # unit tests (no ROS runtime needed)
python3 tests/robot/sim_fault_check.py         # live fault check against a running sim
```

All scripts source `scripts/robot/env.sh`. It sets `ROS_DOMAIN_ID=42` and **forces** `ROS_AUTOMATIC_DISCOVERY_RANGE=LOCALHOST`
and `GZ_IP=127.0.0.1`, so ROS 2 and gz-transport stay on this host and a Wi-Fi drop or IP change cannot cut the
Gazebo↔ROS link. Opt out with `SEMMAL_DISCOVERY_RANGE` / `SEMMAL_GZ_IP`. To run your own `ros2` commands against the
sim, first `source scripts/robot/env.sh`. `run_sim.sh` also exports `APP_MODE=simulation`,
`SIM_FAULT_INJECTION_ENABLED=true`, `SEMMAL_DATA_DIR=<repo>/data` (gitignored) and `ROBOT_ID=robot-demo-001`. It refuses
to start while another SEMMAL simulation is running, because two Gazebo servers share topic names and corrupt each
other's sensor data.

## Packages (`ros2_ws/src`)

| Package | Contents |
|---|---|
| `semmal_interfaces` | `SafetyState`, `FaultEvent`, `MotorDiagnostics`, `FaultOverlay` (sim only), `RobotState` msgs; `InjectFault`, `RequestRecovery` srvs; `ExecuteMission` action |
| `semmal_description` | `semmal_robot.urdf.xacro`: diff-drive base, 2 drive wheels + 1 rear caster, gpu_lidar, RGB camera, IMU, gz DiffDrive + JointStatePublisher systems |
| `semmal_gazebo` | `config/worlds/<world>.yaml` (layouts), `config/models.yaml` (pinned Fuel models + front direction), `config/model_catalog.yaml` (generated footprints), `config/views/<world>.yaml` (preview cameras), `scripts/{generate_world,measure_models,render_views}.py`, generated `worlds/<world>.sdf`, `config/bridge.yaml` |
| `semmal_navigation` | generated static maps `maps/<world>.{pgm,yaml}`; `config/waypoints/<world>.yaml` (allowlist, route graph, geofence) |
| `semmal_bringup` | `sim.launch.py`, `robot.launch.py`, `full.launch.py`, `config/semmal.yaml` (all node params), `config/semmal.rviz` |
| `semmal_base` | `motor_sim_node`, `battery_node`, `robot_state_node` |
| `semmal_diagnostics` | `diagnostics_node` |
| `semmal_safety` | `safety_supervisor` |
| `semmal_sim_faults` | `fault_injector` + `scenarios/*.yaml` (simulation only) |
| `semmal_incident` | `incident_recorder`, `spool_status`; canonical manifest + SQLite spool |
| `semmal_mission` | `mission_executor` (ExecuteMission server, route graph follower) |

## Worlds

Select with `world:=<name>`. The launch reads the spawn pose from the layout, and the waypoint allowlist and geofence
from `semmal_navigation/config/waypoints/<name>.yaml`.

| World | Size | Contents | Inspection target |
|---|---|---|---|
| `warehouse` (default) | 20 × 14 m | three shelf rows, pallet stacks, pillar | orange machine panel, east wall |
| `house` | 24 × 18 m | nine rooms off a central hallway (garage/dock, utility, bathroom, office, bedroom, guest room, open kitchen/dining, living room) with 45 Fuel furniture models (26 distinct, CC BY 4.0, see `docs/MODEL_CREDITS.md`) | electrical box on a shelf, utility room |

House waypoints: `dock`, `inspection_point_A`, `kitchen`, `living_room`, `bathroom`, `office`, `bedroom`, `guest_room`.

**Pipeline** (all deterministic, offline after `fetch_models.sh`):
1. `config/models.yaml` pins each Fuel model URI to a version and records which way its front faces (`front_deg`).
   The front directions were verified by rendering every model placed `facing: south` in front of a camera.
2. `measure_models.py` loads each model in a headless gz-sim server and records its collision bounding box
   (`Link.compute_axis_aligned_box`, transformed by the link pose) in `model_catalog.yaml`. No hand-parsed meshes.
3. `generate_world.py` turns `config/worlds/<world>.yaml` (walls with door gaps, room floors, boxes, furniture with
   `facing: north|south|east|west`) into `worlds/<world>.sdf` and the occupancy map. Furniture footprints are rotated
   and rasterised. Geometry wholly above `map.max_obstacle_z` is not drawn.
4. `render_views.py` renders PNG previews from named viewpoints with Gazebo's own renderer, e.g.
   `render_views.py worlds/house.sdf out/ --views config/views/house.yaml`.

`tests/robot/test_layout.py` runs for every world. It fails if the generated SDF or map is stale, if any route edge
passes closer than `robot_radius` to a wall or furniture footprint, if furniture penetrates a wall or other furniture
(3 cm contact allowed, mutation-tested), or if any waypoint is unreachable from the dock.

Frames: `map` = Gazebo world frame. DiffDrive odometry starts at zero at the spawn pose, so `sim.launch.py` publishes a
static `map→odom` equal to the spawn pose (known start, no localisation yet). Chain:
`map → odom → base_footprint → base_link → {left,right}_wheel_link, rear_caster_link, base_scan, camera_link → camera_optical_frame, imu_link`.

## Topics, services, actions

| Name | Type | Publisher → subscriber | Rate / QoS | Units / notes |
|---|---|---|---|---|
| `/clock_raw` | rosgraph_msgs/Clock | gz → clock_relay | 1 kHz | raw sim clock, one tick per physics step |
| `/clock` | rosgraph_msgs/Clock | clock_relay → all | 50 Hz | sim time (`use_sim_time: true`); throttled so idle nodes stay cheap |
| `/scan` | sensor_msgs/LaserScan | gz | 10 Hz, sensor QoS | 360 samples, 0.12–12 m, frame `base_scan` |
| `/camera/image_raw`, `/camera/camera_info` | Image (rgb8 640×480), CameraInfo | gz | 15 Hz configured (~8 Hz observed headless) | frame `camera_optical_frame` |
| `/imu/data` | sensor_msgs/Imu | gz | 100 Hz configured | frame `imu_link` |
| `/odom`, `/tf` (odom→base_footprint) | Odometry, TFMessage | gz DiffDrive | 50 Hz | m, rad |
| `/joint_states` | JointState | gz JointStatePublisher | 100 Hz (`update_rate`) | wheel rad, rad/s |
| `/wheel_encoders` | JointState | motor_sim_node | 50 Hz | wheel rad; the sim encoder fault freezes these |
| `/motor/diagnostics` | MotorDiagnostics | motor_sim_node | 50 Hz | A, °C, rad/s |
| `/battery_state` | BatteryState | battery_node | 1 Hz (sim time) | percentage 0–1 |
| `/fault_events` | FaultEvent | diagnostics_node, safety_supervisor | on change, reliable depth 50 | one event per raise and per clear |
| `/diagnostics` | DiagnosticArray | diagnostics_node | 2 Hz | |
| `/cmd_vel_nav` | Twist | mission_executor → supervisor | 20 Hz while moving | m/s, rad/s |
| `/cmd_vel_teleop` | Twist | operator → supervisor | — | priority over nav while fresh (0.5 s) |
| **`/cmd_vel`** | Twist | **safety_supervisor only** → gz | 20 Hz always (steady clock) | final, limited command |
| `/emergency_stop` | std_msgs/Bool | operator/hardware → supervisor | reliable, transient_local | true = pressed; latches |
| `/safety/stop_request` | std_msgs/Bool | master agent → supervisor | reliable, transient_local | soft, non-latching ramped stop (e.g. `WAITING_FOR_0G`) |
| `/safety/state` | SafetyState | safety_supervisor | 20 Hz, reliable, transient_local | |
| `/safety/request_recovery` | srv RequestRecovery | operator → supervisor | | needs operator_id + approval; only from RECOVERY_REQUIRED |
| `/mission/execute` | action ExecuteMission | master agent → mission_executor | | named waypoints only |
| `/mission/status` | std_msgs/String (JSON) | mission_executor | on change, transient_local | phase, task_id, episode_id |
| `/robot/state` | RobotState | robot_state_node | 2 Hz | coarse map-frame pose for the gateway |
| `/incidents/recorded` | std_msgs/String (JSON) | incident_recorder | on record, reliable | id, sequence, stage, manifest hash |
| `/incidents/pending` | std_msgs/String (JSON) | incident_recorder | 1 Hz, transient_local | pending count, oldest |
| `/sim/fault_inject`, `/sim/fault_clear` | srv InjectFault, std_srvs/Trigger | → fault_injector | | simulation only |
| `/sim/motor_fault_overlay` | FaultOverlay | fault_injector → motor_sim_node | 50 Hz while active | simulation only |

## Safety boundary

- `safety_supervisor` is the only `/cmd_vel` publisher. It runs on a **steady clock** at 20 Hz, so a stalled
  `/clock` cannot freeze it. It enforces speed/acceleration limits, a front/rear lidar stop/slow zone, the geofence,
  heartbeats (scan 1.0 s, odom/encoders/motor diagnostics 0.5 s), and the e-stop input.
- States: `NORMAL`, `DEGRADED` (warnings, or waiting for first sensors: zero output), `STOPPING` (soft ramp, not
  latched), `E_STOP` (hard zero, latched), `RECOVERY_REQUIRED` (critical conditions gone, still latched).
  The only way out of a latch is `/safety/request_recovery` with `operator_approved: true` and an `operator_id`.
  Velocity input received before the recovery is discarded.
- Any exception in the supervisor's tick publishes zero and latches `SUPERVISOR_INTERNAL_ERROR`. If the supervisor
  process exits, `robot.launch.py` shuts down the whole simulation, because Gazebo's DiffDrive keeps executing the
  last command it received (it has no command timeout). Real hardware needs a motor-driver watchdog for the same reason.
- `mission_executor` aborts with `ABORTED_SAFETY` as soon as the state is `STOPPING`, `E_STOP` or `RECOVERY_REQUIRED`,
  and refuses goals unless motion is permitted.
- Fault detection (`diagnostics_node`, 50 Hz): overcurrent/overtemperature (debounce 0.2 s), encoder stale while
  motion is commanded (0.5 s), wheel-response mismatch (warning), motor/encoder watchdog (0.5 s), battery low/critical.
  Faults clear after 2 s of normal readings. Clearing never clears the latch.
- None of this path calls AI, the network, Arkiv or 0G Storage.

## Incident spool

`incident_recorder` writes every raised critical fault to `$SEMMAL_DATA_DIR/robot/incident_spool.db` (SQLite WAL,
`synchronous=FULL`) before doing anything else. Each row has a unique incident ID, an idempotency key derived from the
source fault event (duplicate delivery returns the existing row), a gap-free sequence number, and the canonical manifest
(§8.3) with `previous_event_hash` chaining. `robot_signature` is `SIMULATED_SIGNATURE` until the owner's wallet signs the
manifest hash. Stages advance only in order `LOCAL_DURABLE → STORAGE_CONFIRMED` (needs root) `→ ARKIV_CONFIRMED`
(needs entity key), enforced by SQL CHECK constraints and the spool API. Bounded exponential backoff is
recorded per stage. The outbox that performs the remote writes is not built yet (Phases 5–7).

## Mission executor

Accepts ≤ 10 waypoint **names** from the world's allowlist (`config/waypoints/<world>.yaml`), `max_speed`
(capped at 0.4 m/s), `dwell_s` (≤ 60 s) and `capture_keyframe`. It joins the nearest route-graph edge, follows the
shortest path, aligns to the waypoint yaw and optionally saves one camera frame **on the robot host**
(`$SEMMAL_DATA_DIR/robot/keyframes/<task_id>/*.ppm`). It never uploads. Nav2 is not installed on this host; the route
follower is the current navigation path. Nav2 (with AMCL) can replace it later behind the same action interface.

## Known limitations

- Localisation is odometry plus the known spawn pose. Odometry matched Gazebo ground truth to < 1 mm in the drift
  check, but long missions or collisions would accumulate error until AMCL/Nav2 is added.
- The route follower does not plan around unexpected obstacles. The supervisor stops the robot, and the mission fails
  after 20 s without progress.
- Motor current/temperature come from a first-order plant model, not real hardware.
- `/joint_states` is published at 100 Hz (JointStatePublisher `update_rate`; its default is every 1 kHz physics step).
- The camera runs at ~8–10 Hz headless on this host (15 Hz configured).
- Encoder-stale detection only counts while that wheel is commanded faster than 0.5 rad/s, so it is slower on routes
  with much turning (522 ms in the warehouse, 789 ms in the house, deadline 0.8 s). Making it robust is an open item.
- House doors are openings, not hinged doors. Furniture is static.
