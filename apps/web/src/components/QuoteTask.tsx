"use client";
/** Ask a registered robot for a quote: pick the robot and the job, see its line-by-line price. */
import Link from "next/link";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { ROBOT_MODELS, ROBOT_SKILLS } from "@semmal/contracts";
import { useApi, type Listing, type RobotProfile } from "@/lib/api";
import { QuoteBreakdown, type QuoteResult } from "./QuoteBreakdown";
import { RobotCanvas, RobotView } from "./robots3d/Robot3D";

const PRIVACY = [
  { id: "private", label: "Private" },
  { id: "verified", label: "Verified" },
  { id: "standard", label: "Any" },
] as const;

const assetOf = (r: RobotProfile) => ROBOT_MODELS.find((m) => m.id === r.model)?.asset ?? "rover";

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
    setQ(null);
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
    }, 280);
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
  if (!robot) return <p className="muted">Reading Arkiv…</p>;

  return (
    <div className="qt">
      <RobotCanvas />
      <div className="qt__robots" role="radiogroup" aria-label="Robot">
        {robots.map((r) => (
          <button key={r.data.robotId} type="button" role="radio" aria-checked={r.data.robotId === robot.robotId} className={`qt-robot ${r.data.robotId === robot.robotId ? "is-on" : ""}`} onClick={() => setRobotId(r.data.robotId)}>
            <RobotView asset={assetOf(r.data)} active={r.data.robotId === robot.robotId} className="qt-robot__view" />
            <b>{r.data.displayName}</b>
            <span className="muted t-small">{r.data.pricing!.minFee}–{r.data.pricing!.maxQuote} USDC · {r.data.pricing!.marginPct}% margin</span>
          </button>
        ))}
      </div>

      <div className="qt__body">
        <div className="choose__controls">
          <fieldset>
            <legend className="t-label muted">The job</legend>
            <div className="chip-row">
              {robot.capabilities.map((c) => (
                <button key={c} type="button" className={`pill-opt ${skill === c ? "is-on" : ""}`} aria-pressed={skill === c} onClick={() => setSkill(c)}>
                  {ROBOT_SKILLS.find((x) => x.id === c)?.label ?? c}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="range">
            <span className="t-label muted">Stops</span>
            <span className="range__val">{waypoints}</span>
            <input type="range" min={1} max={20} value={waypoints} onChange={(e) => setWaypoints(Number(e.target.value))} />
          </label>
          <label className="range">
            <span className="t-label muted">Distance</span>
            <span className="range__val">{distance} <small>m</small></span>
            <input type="range" min={10} max={2000} step={10} value={distance} onChange={(e) => setDistance(Number(e.target.value))} />
          </label>
          <fieldset>
            <legend className="t-label muted">Inference trust</legend>
            <div className="seg" role="radiogroup">
              {PRIVACY.map((p) => (
                <button key={p.id} type="button" role="radio" aria-checked={privacy === p.id} className="seg__opt" onClick={() => setPrivacy(p.id)}>
                  {privacy === p.id && <motion.span layoutId="seg-privacy" className="seg__ind" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                  <span>{p.label}</span>
                </button>
              ))}
            </div>
          </fieldset>
        </div>
        <div>
          {err ? <p className="soft-warn">{err}</p> : <QuoteBreakdown q={q} />}
          <p className="t-small muted qt__foot">
            Priced by code from live Arkiv and 0G prices, never by an AI guess. The robot accepts the job only at this quote.
          </p>
        </div>
      </div>
    </div>
  );
}
