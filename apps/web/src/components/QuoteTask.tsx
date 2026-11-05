"use client";
/**
 * Ask a registered robot for a quote. A one-screen workbench on desktop:
 * robots (left) · the job (middle) · the robot's quote (right, total pinned, lines scroll).
 */
import Link from "next/link";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { ROBOT_MODELS, ROBOT_SKILLS } from "@semmal/contracts";
import { useApi, type Listing, type RobotProfile } from "@/lib/api";
import { QuoteLines, type QuoteResult } from "./QuoteBreakdown";
import { RobotCanvas, RobotView } from "./robots3d/Robot3D";

const PRIVACY = [
  { id: "private", label: "Private", hint: "TEE only, prompts stay inside" },
  { id: "verified", label: "Verified", hint: "Signed by the provider" },
  { id: "standard", label: "Any", hint: "Cheapest provider" },
] as const;

const assetOf = (r: RobotProfile) => ROBOT_MODELS.find((m) => m.id === r.model)?.asset ?? "rover";
const typeName = (r: RobotProfile) => ROBOT_MODELS.find((m) => m.id === r.model)?.name ?? "Robot";

function SliderField({ id, label, unit, min, max, step, value, onChange }: { id: string; label: string; unit?: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="sf">
      <div className="sf__top">
        <label htmlFor={`${id}-n`} className="t-label muted">{label}</label>
        <span className="sf__num">
          <input id={`${id}-n`} type="number" inputMode="numeric" min={min} max={max} step={step} value={value} onChange={(e) => onChange(clamp(Number(e.target.value)))} />
          {unit && <small>{unit}</small>}
        </span>
      </div>
      <input
        aria-label={label}
        className="sf__range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ["--p" as string]: `${pct}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="sf__ends muted"><span>{min}{unit ? ` ${unit}` : ""}</span><span>{max}{unit ? ` ${unit}` : ""}</span></div>
    </div>
  );
}

export function QuoteTask() {
  const { data, error } = useApi<Listing<RobotProfile>>("/api/robots");
  const robots = useMemo(() => (data?.items ?? []).filter((r) => r.data.pricing), [data]);
  const [robotId, setRobotId] = useState<string | null>(null);
  const robot = robots.find((r) => r.data.robotId === robotId)?.data ?? robots[0]?.data;
  const [skill, setSkill] = useState<string>("");
  const [waypoints, setWaypoints] = useState(4);
  const [distance, setDistance] = useState(160);
  const [privacy, setPrivacy] = useState<(typeof PRIVACY)[number]["id"]>("private");
  const [q, setQ] = useState<QuoteResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (robot && !robot.capabilities.includes(skill)) setSkill(robot.capabilities[0] ?? "");
  }, [robot, skill]);

  useEffect(() => {
    if (!robot || !skill) return;
    setErr(null);
    const t = setTimeout(() => {
      fetch("/api/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ robotId: robot.robotId, plan: { skill, waypoints, distanceM: distance, privacy } }),
      })
        .then(async (r) => {
          const d = await r.json();
          if (!r.ok) throw new Error(d.error ?? "Quote failed");
          setQ(d);
        })
        .catch((e) => setErr((e as Error).message));
    }, 250);
    return () => clearTimeout(t);
  }, [robot, skill, waypoints, distance, privacy]);

  if (error) return <p className="notice">{error}</p>;
  if (data && robots.length === 0)
    return (
      <div className="empty">
        <h3 className="t-card">No robots on Arkiv can quote yet</h3>
        <p className="muted">Register a robot with a pricing policy, then ask it for a quote here.</p>
        <Link className="btn btn--primary" href="/robots/new">Register a robot</Link>
      </div>
    );
  if (!robot) return <div className="wb wb--loading" aria-busy="true" />;

  const status =
    q?.status === "ok" ? `Quote from ${robot.displayName}: ${q.quote} USDC` : q?.status === "declined" ? `${robot.displayName} declines: ${q.reason}` : "Working out the price";

  return (
    <div className="wb">
      <RobotCanvas />

      {/* robots */}
      <aside className="wb__col wb__robots" aria-label="Robots on Arkiv">
        <div className="wb__colhead">
          <span className="t-label muted">Robots</span>
          <span className="wb__count">{robots.length}</span>
        </div>
        <div className="wb__scroll" role="radiogroup" aria-label="Choose a robot">
          {robots.map((r) => {
            const on = r.data.robotId === robot.robotId;
            return (
              <button key={r.data.robotId} type="button" role="radio" aria-checked={on} className={`rb ${on ? "is-on" : ""}`} onClick={() => setRobotId(r.data.robotId)}>
                <RobotView asset={assetOf(r.data)} active={on} className="rb__view" zoom={1.1} />
                <span className="rb__txt">
                  <b>{r.data.displayName}</b>
                  <span className="muted">{typeName(r.data)}</span>
                  <span className="rb__range">{r.data.pricing!.minFee}–{r.data.pricing!.maxQuote} USDC</span>
                </span>
              </button>
            );
          })}
        </div>
        <Link className="wb__add" href="/robots/new">+ Register a robot</Link>
      </aside>

      {/* the job */}
      <section className="wb__col wb__job" aria-labelledby="job-h">
        <div className="wb__colhead"><h2 id="job-h" className="t-label muted">The job</h2></div>
        <div className="wb__fields">
          <fieldset className="wb__field">
            <legend className="t-label muted">Work</legend>
            <div className="chip-row">
              {robot.capabilities.map((c) => (
                <button key={c} type="button" className={`pill-opt ${skill === c ? "is-on" : ""}`} aria-pressed={skill === c} onClick={() => setSkill(c)}>
                  {ROBOT_SKILLS.find((x) => x.id === c)?.label ?? c}
                </button>
              ))}
            </div>
          </fieldset>
          <SliderField id="stops" label="Stops" min={1} max={20} step={1} value={waypoints} onChange={setWaypoints} />
          <SliderField id="dist" label="Distance" unit="m" min={10} max={2000} step={10} value={distance} onChange={setDistance} />
          <fieldset className="wb__field">
            <legend className="t-label muted">Inference trust</legend>
            <div className="seg" role="radiogroup">
              {PRIVACY.map((p) => (
                <button key={p.id} type="button" role="radio" aria-checked={privacy === p.id} className="seg__opt" onClick={() => setPrivacy(p.id)}>
                  {privacy === p.id && <motion.span layoutId="seg-privacy" className="seg__ind" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                  <span>{p.label}</span>
                </button>
              ))}
            </div>
            <p className="t-small muted wb__hint">{PRIVACY.find((p) => p.id === privacy)!.hint}</p>
          </fieldset>
        </div>
        <p className="t-small muted wb__foot">Priced by code from live Arkiv and 0G prices, never by an AI guess.</p>
      </section>

      {/* the quote */}
      <section className={`wb__col wb__quote ${q?.status === "declined" ? "is-declined" : q?.status === "ok" ? "is-ok" : ""}`} aria-labelledby="quote-h">
        <span role="status" aria-atomic="true" className="sr-only">{status}</span>
        <div className="wq__head">
          <RobotView asset={assetOf(robot)} active className="wq__view" zoom={1.05} />
          <div className="wq__sum">
            <h2 id="quote-h" className="t-label muted">{robot.displayName} quotes</h2>
            {err ? (
              <span className="wq__reason">{err}</span>
            ) : !q ? (
              <span className="wq__total muted">…</span>
            ) : q.status === "ok" ? (
              <motion.span key={q.quote} className="wq__total" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                {q.quote}<small>USDC</small>
              </motion.span>
            ) : (
              <>
                <span className="wq__declined">Declines this job</span>
                <span className="wq__reason">{q.reason}</span>
              </>
            )}
            {q?.status === "ok" && <span className="t-small muted">Cost {q.cost} · margin {q.marginApplied}</span>}
          </div>
        </div>
        <div className="wb__scroll wq__lines">{q && !err && <QuoteLines q={q} />}</div>
      </section>
    </div>
  );
}
