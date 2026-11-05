"use client";
/**
 * Interactive preview of the robot's hiring rule (CLAUDE.md 6.3): filter by capability, trust mode
 * and budget, then rank by trust strength and price. Uses the agent listings from the API.
 */
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useMemo, useState } from "react";
import { useApi, type AgentListing, type Listing } from "@/lib/api";
import { kindIcon } from "../ui/Icons";
import { ProvenanceBadge } from "../ui/Provenance";

const TASKS = [
  { id: "vision", label: "Read the panel" },
  { id: "inspection", label: "Plan the survey" },
  { id: "maintenance", label: "Diagnose a fault" },
] as const;
const TRUST = [
  { id: "private", label: "Private", hint: "TEE only, prompts stay inside" },
  { id: "verified", label: "Verified", hint: "Signed by the provider" },
  { id: "standard", label: "Any", hint: "Cheapest provider" },
] as const;
const strength = { private: 3, verified: 2, standard: 1 } as const;

type Verdict = { a: AgentListing; ok: boolean; reason: string; provenance: string; entityKey?: string };

export function Chooser() {
  const { data } = useApi<Listing<AgentListing>>("/api/agents");
  const [task, setTask] = useState<(typeof TASKS)[number]["id"]>("vision");
  const [trust, setTrust] = useState<(typeof TRUST)[number]["id"]>("private");
  const [budget, setBudget] = useState(0.5);

  const verdicts = useMemo<Verdict[]>(() => {
    const all = (data?.items ?? []).map((e) => {
      const a = e.data;
      const mode = a.inference?.trustMode ?? "standard";
      const price = Number(a.price.amount);
      let reason = "";
      if (a.kind !== task) reason = "different capability";
      else if (strength[mode] < strength[trust]) reason = `${mode} only, needs ${trust}`;
      else if (price > budget) reason = `over budget by ${(price - budget).toFixed(2)}`;
      return { a, ok: reason === "", reason, provenance: e.provenance, entityKey: e.entityKey };
    });
    const fit = all.filter((v) => v.ok).sort((x, y) => strength[y.a.inference?.trustMode ?? "standard"] - strength[x.a.inference?.trustMode ?? "standard"] || Number(x.a.price.amount) - Number(y.a.price.amount));
    const rest = all.filter((v) => !v.ok).sort((x, y) => Number(x.a.kind !== task) - Number(y.a.kind !== task));
    return [...fit, ...rest];
  }, [data, task, trust, budget]);
  const hired = verdicts.find((v) => v.ok);

  return (
    <section id="choose" className="section choose" aria-labelledby="choose-h">
      <div className="wrap">
        <div className="section-head section-head--split">
          <h2 id="choose-h">How a robot picks its agents <span className="muted">try the rule</span></h2>
          <p className="t-small muted measure">Change the job, the trust it needs and the budget. The robot filters the registry, then takes the strongest trust at the lowest price.</p>
        </div>

        <div className="choose__grid">
          <div className="choose__controls">
            <fieldset>
              <legend className="t-label muted">The job</legend>
              <div className="seg" role="radiogroup">
                {TASKS.map((t) => (
                  <button key={t.id} type="button" role="radio" aria-checked={task === t.id} className="seg__opt" onClick={() => setTask(t.id)}>
                    {task === t.id && <motion.span layoutId="seg-task" className="seg__ind" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="t-label muted">Trust it needs</legend>
              <div className="seg" role="radiogroup">
                {TRUST.map((t) => (
                  <button key={t.id} type="button" role="radio" aria-checked={trust === t.id} className="seg__opt" onClick={() => setTrust(t.id)} title={t.hint}>
                    {trust === t.id && <motion.span layoutId="seg-trust" className="seg__ind" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>
              <p className="t-small muted">{TRUST.find((t) => t.id === trust)!.hint}</p>
            </fieldset>
            <label className="range">
              <span className="t-label muted">Budget for this job</span>
              <span className="range__val">{budget.toFixed(2)} <small>USDC</small></span>
              <input type="range" min={0.1} max={2} step={0.05} value={budget} onChange={(e) => setBudget(Number(e.target.value))} aria-valuetext={`${budget.toFixed(2)} USDC`} />
            </label>
          </div>

          <div className="choose__result" aria-live="polite">
            <LayoutGroup>
              <ul className="pick-list">
                <AnimatePresence initial={false}>
                  {verdicts.map((v) => {
                    const isHired = hired?.a.agentId === v.a.agentId;
                    return (
                      <motion.li
                        key={v.a.agentId}
                        layout
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: v.ok ? 1 : 0.42, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ type: "spring", stiffness: 360, damping: 32 }}
                        className={`pick ${isHired ? "is-hired" : ""}`}
                      >
                        <span className="pick__icon">{kindIcon(v.a.kind, 18)}</span>
                        <span className="pick__name">
                          <b>{v.a.displayName}</b>
                          <span>{v.ok ? (isHired ? "Hired by Rover 01" : "Eligible, ranked lower") : v.reason}</span>
                        </span>
                        <span className="pick__price">{v.a.price.amount}</span>
                        <span className={`pick__trust pick__trust--${v.a.inference?.trustMode ?? "none"}`}>{v.a.inference?.trustMode ?? "none"}</span>
                        {isHired && <motion.span layoutId="hired-tag" className="pick__tag">Hired</motion.span>}
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ul>
            </LayoutGroup>
            {!hired && data && <p className="choose__none">No agent fits. The robot reports it cannot take this job instead of lowering the bar.</p>}
            <div className="choose__foot">
              {data && <ProvenanceBadge provenance={data.items[0]?.provenance ?? "SIMULATED"} />}
              <span className="t-small muted">Rule preview · the robot&apos;s master agent is the next build phase</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
