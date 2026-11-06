"use client";
/**
 * The operator console as live HTML (the product's own screen, taste-skill "app-frame").
 * It shows one example mission (labelled Example). Values that only exist after a live call (the 0G request ID,
 * the Arkiv entity key) are shown as pending, never invented.
 */
import { useEffect, useRef, useState } from "react";

const STEPS = [
  { t: "09:41:02", label: "Task assigned by marketplace", who: "marketplace", state: "done" },
  { t: "09:41:03", label: "Registry search: vision.panel-inspection", who: "Rover 01", state: "done" },
  { t: "09:41:04", label: "Paid Lumen Vision · 0.012 0G", who: "Rover 01", state: "done" },
  { t: "09:41:04", label: "Paid Ostra Inspection · 0.004 0G", who: "Rover 01", state: "done" },
  { t: "09:43:18", label: "Reached panel C-14", who: "Nav2", state: "done" },
  { t: "09:43:19", label: "Private inference requested", who: "Lumen Vision", state: "done" },
  { t: "09:43:21", label: "Obstruction at vent · confidence 0.87", who: "Lumen Vision", state: "warn" },
  { t: "09:43:22", label: "Left motor overcurrent · E-stop latched", who: "safety", state: "stop" },
  { t: "09:43:22", label: "Incident saved locally · seq 42", who: "Rover 01", state: "done" },
];

const TABS = ["Timeline", "Specialists", "Evidence"] as const;

export function Console() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Timeline");
  const [run, setRun] = useState(0);
  const played = useRef(false);
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // play the mission once when the console first comes into view
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting && !played.current) { played.current = true; setRun((r) => r + 1); }
    }, { threshold: 0.4 });
    if (frame.current) io.observe(frame.current);
    return () => io.disconnect();
  }, []);
  return (
    <section id="console" className="section console-sec" aria-labelledby="console-h">
      <div className="wrap">
        <div className="section-head section-head--split">
          <h2 id="console-h">One console for every mission <span className="muted">from task to record</span></h2>
          <p className="t-small muted measure">Operators see what the robot decided, which agents it paid, what 0G returned and what is saved where.</p>
        </div>

        <div ref={frame} className="app-frame" aria-label="Semmal console showing Rover 01's panel inspection: hired agents, a private 0G call, an obstruction finding and a latched emergency stop">
          <div className="app-frame__bar">
            <span className="app-frame__dots" aria-hidden="true"><i /><i /><i /></span>
            <span>Semmal console · Rover 01 · panel inspection</span>
            <span className="app-frame__sim">Example</span>
          </div>
          <div className="app-frame__body">
            <nav className="cx-side" aria-hidden="true">
              <span className="is-on">Missions</span>
              <span>Robots</span>
              <span>Agents</span>
              <span>Incidents <b>1</b></span>
              <span>Registry</span>
              <span className="cx-side__label">Fleet</span>
              <span><i className="dot dot--bad" />Rover 01</span>
              <span><i className="dot dot--ok" />Rover 02</span>
            </nav>

            <div className="cx-main">
              <div className="cx-head">
                <div>
                  <h3>Panel inspection · Aisle C</h3>
                  <p className="mono">task-demo-001 · budget 0.06 0G · spent 0.016</p>
                </div>
                <div className="cx-head__right">
                  <button type="button" className="cx-replay" onClick={() => { setTab("Timeline"); setRun((r) => r + 1); }}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v3.7h3.7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    Replay mission
                  </button>
                  <span className="cx-state cx-state--stop">Emergency stop latched</span>
                </div>
              </div>
              <div className="cx-tabs" role="tablist" aria-label="Console views">
                {TABS.map((t) => (
                  <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
                    {t}
                  </button>
                ))}
              </div>

              {tab === "Timeline" && (
                <ol className="cx-time" key={run} data-run={run}>
                  {STEPS.map((s, i) => (
                    <li key={i} className={`is-${s.state}`} style={{ ["--i" as string]: i }}>
                      <span className="mono">{s.t}</span>
                      <i aria-hidden="true" />
                      <span>{s.label}</span>
                      <span className="muted">{s.who}</span>
                    </li>
                  ))}
                </ol>
              )}
              {tab === "Specialists" && (
                <div className="cx-rows">
                  <div className="cx-row cx-row--head"><span>Agent</span><span>Why chosen</span><span>Price</span><span>Trust</span></div>
                  <div className="cx-row"><b>Lumen Vision</b><span>panel capability, private mode</span><span className="mono">0.40</span><span className="chip chip--ok">private</span></div>
                  <div className="cx-row"><b>Ostra Inspection</b><span>may delegate up to 40%</span><span className="mono">1.10</span><span className="chip chip--ok">private</span></div>
                  <div className="cx-row is-dim"><b>Kestrel Vision</b><span>cheaper, but verified only</span><span className="mono">0.25</span><span className="chip">rejected</span></div>
                  <div className="cx-row"><b>Torque Maintenance</b><span>queued after the stop, advisory</span><span className="mono">0.80</span><span className="chip chip--warn">pending</span></div>
                </div>
              )}
              {tab === "Evidence" && (
                <div className="cx-evidence">
                  <div><span className="t-label muted">0G request ID</span><span className="mono">shown after the first live call</span></div>
                  <div><span className="t-label muted">Model · trust</span><span className="mono">0gm-1.0-35b-a3b · private</span></div>
                  <div><span className="t-label muted">Local spool</span><span className="mono"><i className="dot dot--ok" />LOCAL_DURABLE · seq 42</span></div>
                  <div><span className="t-label muted">0G Storage</span><span className="mono"><i className="dot dot--warn" />pending upload</span></div>
                  <div><span className="t-label muted">Arkiv index</span><span className="mono"><i className="dot dot--warn" />waits for the Storage root</span></div>
                  <div><span className="t-label muted">Recovery</span><span className="mono">operator approval required</span></div>
                </div>
              )}
            </div>

            <aside className="cx-aside" aria-hidden="true">
              <div className="cx-card">
                <span className="t-label muted">Vision result</span>
                <pre className="mono">{`{
  "observation": "machine_panel",
  "anomaly_detected": true,
  "anomaly_type": "possible_obstruction",
  "confidence": 0.87,
  "recommended_action":
    "pause_and_request_inspection"
}`}</pre>
                <span className="chip chip--ok">schema valid</span>
              </div>
              <div className="cx-card cx-card--stop">
                <span className="t-label">Safety</span>
                <b>Left motor 8.5 A · 105 °C</b>
                <span className="t-small">Stopped on the robot with no network and no AI. Waits for an operator.</span>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </section>
  );
}
