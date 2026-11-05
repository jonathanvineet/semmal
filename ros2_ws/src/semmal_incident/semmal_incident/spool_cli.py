"""spool_status: print the local incident spool (no ROS needed). Usage: spool_status [--path P] [--json]"""
import argparse
import json

from .incident_recorder_node import default_spool_path
from .spool import IncidentSpool


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--path', default=default_spool_path())
    ap.add_argument('--json', action='store_true')
    a = ap.parse_args(argv)
    s = IncidentSpool(a.path)
    rows = s.all()
    if a.json:
        print(json.dumps({'summary': s.pending_summary(), 'incidents': rows}, indent=2))
        return 0
    print(f'spool: {a.path}')
    print(json.dumps(s.pending_summary()))
    for r in rows:
        print(f'#{r["sequence_number"]:>4} {r["stage"]:<18} {r["fault_code"]:<30} {r["detected_at"]} {r["incident_id"]}')
    return 0
