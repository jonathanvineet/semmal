from semmal_diagnostics.core import DiagnosticsConfig, DiagnosticsCore


def motor(core, t, lc=1.0, lt=30.0, lcmd=0.0, lmeas=0.0, lpos=None):
    core.on_motor(t, lc, 1.0, lt, 30.0, lcmd, 0.0, lmeas, 0.0)


def run(core, t0, t1, dt=0.02, **kw):
    events, t = [], t0
    while t <= t1 + 1e-9:
        motor(core, t, **kw)
        core.on_encoders(t, kw.get('lpos', t), 0.0 if 'lpos' in kw else t)
        events += [(round(t, 3), e) for e in core.step(t)]
        t += dt
    return events


def codes(evs, active=True):
    return [e['code'] for _t, e in evs if e['active'] == active]


def test_overcurrent_detected_within_debounce_deadline():
    c = DiagnosticsCore(DiagnosticsConfig())
    run(c, 0.0, 1.0)
    evs = run(c, 1.02, 2.0, lc=8.5, lt=105.0)
    raised = [(t, e['code']) for t, e in evs if e['active']]
    assert ('LEFT_MOTOR_OVERCURRENT' in [r[1] for r in raised])
    t_detect = min(t for t, code in raised if code == 'LEFT_MOTOR_OVERCURRENT')
    assert t_detect - 1.02 <= 0.25  # debounce 0.2 s + one tick
    assert next(e for _t, e in evs if e['code'] == 'LEFT_MOTOR_OVERCURRENT')['severity'] == 'critical'


def test_brief_spike_is_debounced():
    c = DiagnosticsCore(DiagnosticsConfig())
    run(c, 0.0, 1.0)
    evs = run(c, 1.02, 1.1, lc=8.5)
    evs += run(c, 1.12, 2.0)
    assert 'LEFT_MOTOR_OVERCURRENT' not in codes(evs)


def test_fault_clears_only_after_hold():
    c = DiagnosticsCore(DiagnosticsConfig())
    run(c, 0.0, 1.0, lc=8.5)
    evs = run(c, 1.02, 2.5)
    assert 'LEFT_MOTOR_OVERCURRENT' not in codes(evs, active=False)
    evs = run(c, 2.52, 4.0)
    assert 'LEFT_MOTOR_OVERCURRENT' in codes(evs, active=False)


def test_encoder_stale_only_while_motion_commanded():
    c = DiagnosticsCore(DiagnosticsConfig())
    # frozen encoder with no command: no fault
    evs = run(c, 0.0, 2.0, lpos=1.0)
    assert 'LEFT_ENCODER_STALE' not in codes(evs)
    # frozen encoder while commanded: fault within ~encoder_stale_s
    evs = run(c, 2.02, 3.0, lpos=1.0, lcmd=5.0, lmeas=0.0)
    raised = [t for t, e in evs if e['active'] and e['code'] == 'LEFT_ENCODER_STALE']
    assert raised and raised[0] - 2.02 <= 0.55


def test_watchdog():
    c = DiagnosticsCore(DiagnosticsConfig())
    run(c, 0.0, 0.5)
    evs = c.step(1.2)
    assert {'MOTOR_DIAGNOSTICS_WATCHDOG', 'ENCODER_WATCHDOG'} <= {e['code'] for e in evs if e['active']}
