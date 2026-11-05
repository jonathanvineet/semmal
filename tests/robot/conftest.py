import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'ros2_ws', 'src')
for pkg in ('semmal_safety', 'semmal_diagnostics', 'semmal_incident', 'semmal_mission',
            'semmal_sim_faults', 'semmal_base'):
    sys.path.insert(0, os.path.join(SRC, pkg))
sys.path.insert(0, os.path.join(SRC, 'semmal_gazebo', 'scripts'))
