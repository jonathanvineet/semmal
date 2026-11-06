"use client";
/**
 * Register a robot on Arkiv: nickname -> model -> skills -> robot wallet -> review and publish.
 * The robot's id is derived from its own wallet (one robot, one id). The owner's wallet signs the
 * Arkiv entity; no private key is ever entered.
 */
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatEther, getAddress, isAddress } from "viem";
import { HARDWARE, ROBOT_SKILLS, RobotProfile, type RobotIdentity, type HardwareCheck, SERVICE_AREAS, robotIdFromWallet, type RobotProfile as TRobot } from "@semmal/contracts";
import { Select } from "./ui/Select";
import { ApprovalCard } from "./ui/ApprovalCard";
import { robotCreateArgs } from "@semmal/arkiv-adapter/browser";
import { useWallet } from "@/lib/wallet";
import { useArkivWriter } from "@/lib/arkiv-writer";
import { ARKIV_EXPLORER } from "@/lib/api";
import { QuoteBreakdown, type QuoteResult } from "./QuoteBreakdown";
import { RobotCanvas, RobotSolo, RobotView, preloadRobots } from "./robots3d/Robot3D";
import { MapView } from "./map/MapView";

preloadRobots(HARDWARE.map((x) => x.asset));

type Connect =
  | { ok: false; error: string }
  | { ok: true; verified: boolean; identity: RobotIdentity; robotId: string; hardware: HardwareCheck; checks: { signature: boolean; nonce: boolean; fresh: boolean; factsHash: boolean; modelMatches: boolean } };

const STEPS = ["Nickname", "Connect", "Skills", "Pricing", "Robot wallet", "Publish"] as const;
type Check = { robotId: string; takenByOther: boolean; existing: { entityKey: string; creator: string; profileVersion: number }[]; nextVersion: number };

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const isAmount = (v: string) => /^\d+(\.\d{1,6})?$/.test(v.trim());
const norm = (v: string) => (isAmount(v) ? String(Number(v.trim())) : "");

export function RegisterRobot() {
  const w = useWallet();
  const scroller = useRef<HTMLDivElement>(null);
  const ark = useArkivWriter();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [conn, setConn] = useState<Connect | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [skills, setSkills] = useState<string[]>([]);
  const [minFee, setMinFee] = useState("0.01");
  const [maxQuote, setMaxQuote] = useState("0.15");
  const [margin, setMargin] = useState(25);
  const [spendCap, setSpendCap] = useState("0.1");
  const [example, setExample] = useState<QuoteResult | null>(null);
  const [area, setArea] = useState<string>("");
  const [check, setCheck] = useState<Check | null>(null);
  const [checking, setChecking] = useState(false);
  const [maxFee, setMaxFee] = useState("0.01");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ entityKey: string; txHash: string; robotId: string; version: number } | null>(null);

  // the model and wallet come from the robot itself, checked by the platform (never typed in)
  const verified = conn?.ok && conn.verified && conn.hardware.ok ? conn : null;
  const model = verified && verified.hardware.ok ? verified.hardware.model : "";
  const m = HARDWARE.find((x) => x.id === model) ?? HARDWARE[1];
  const robotWallet = verified ? verified.identity.wallet : "";
  // the base the robot reported (already rounded to about 1 km by the robot) and how far it travels
  const vf = verified?.identity.facts;
  const base = vf?.baseLat && vf?.baseLon ? { lat: Number(vf.baseLat), lon: Number(vf.baseLon) } : null;
  const radiusKm = vf?.serviceRadiusKm ? Number(vf.serviceRadiusKm) : undefined;

  const connect = async () => {
    setConnecting(true);
    setConn(null);
    try {
      const [h, port] = host.trim().replace(/^https?:\/\//, "").split(":");
      const r = await fetch("/api/robots/connect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ host: h, ...(port ? { port: Number(port) } : {}) }) });
      const d = (await r.json()) as Connect;
      setConn(d);
      if (d.ok && d.verified && d.hardware.ok) {
        const hw = HARDWARE.find((x) => x.id === (d.hardware as { model: string }).model)!;
        setSkills((cur) => {
          const keep = cur.filter((c) => (hw.skills as readonly string[]).includes(c));
          return keep.length ? keep : [hw.skills[0]];
        });
      }
    } catch {
      setConn({ ok: false, error: "The SEMMAL API is not reachable." });
    } finally {
      setConnecting(false);
    }
  };
  const skillChoices = ROBOT_SKILLS.filter((x) => (m.skills as readonly string[]).includes(x.id));
  const walletOk = isAddress(robotWallet);
  const robotId = walletOk ? robotIdFromWallet(robotWallet) : "";
  const sameAsOwner = Boolean(walletOk && w.account && getAddress(robotWallet) === getAddress(w.account));

  useEffect(() => {
    ark.refreshBalance(w.account);
  }, [w.account, ark.onRabdi]); // eslint-disable-line react-hooks/exhaustive-deps

  // uniqueness check whenever the robot wallet (or the owner) changes
  useEffect(() => {
    setCheck(null);
    if (!walletOk) return;
    setChecking(true);
    const t = setTimeout(() => {
      const q = new URLSearchParams({ wallet: robotWallet, ...(w.account ? { owner: w.account } : {}) });
      fetch(`/api/robots/check?${q}`)
        .then((r) => r.json())
        .then((d) => setCheck(d.robotId ? d : null))
        .catch(() => setCheck(null))
        .finally(() => setChecking(false));
    }, 350);
    return () => clearTimeout(t);
  }, [robotWallet, walletOk, w.account]);

  const profile = useMemo<TRobot | null>(() => {
    if (!walletOk || !w.account) return null;
    const draft = {
      schemaVersion: "1.0" as const,
      robotId,
      robotWallet: getAddress(robotWallet),
      ownerWallet: getAddress(w.account),
      displayName: name.trim(),
      model: model as TRobot["model"],
      robotType: m.robotType,
      hardware: { base: m.base, sensors: [...m.sensors] },
      ...(verified ? { attestation: (({ schema: _s, ...rest }) => rest)(verified.identity) } : {}),
      ...(base ? { location: base } : {}),
      ...(radiusKm ? { serviceRadiusKm: radiusKm } : {}),
      capabilities: skills as TRobot["capabilities"],
      rosInterfaceVersion: "0.1.0",
      profileVersion: check?.nextVersion ?? 1,
      serviceArea: area,
      pricing: { token: "0G" as const, minFee: norm(minFee), maxQuote: norm(maxQuote), marginPct: margin, maxSpendPerTask: norm(spendCap) },
    };
    const r = RobotProfile.safeParse(draft);
    return r.success ? r.data : null;
  }, [walletOk, w.account, robotId, robotWallet, name, model, m, skills, check, area, minFee, maxQuote, margin, spendCap, verified, base?.lat, base?.lon, radiusKm]);

  const policyOk = isAmount(minFee) && isAmount(maxQuote) && isAmount(spendCap) && Number(maxQuote) >= Number(minFee) && Number(minFee) > 0;
  // a live example quote for the first chosen skill, so the owner sees what their limits do
  useEffect(() => {
    if (step !== 3 || !policyOk || !skills[0]) return;
    setExample(null);
    const t = setTimeout(() => {
      fetch("/api/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          preview: { robotType: m.robotType, policy: { token: "0G", minFee: norm(minFee), maxQuote: norm(maxQuote), marginPct: margin, maxSpendPerTask: norm(spendCap) } },
          plan: { skill: skills[0], waypoints: 4, distanceM: 160, privacy: "private" },
        }),
      })
        .then((r) => r.json())
        .then((d) => setExample(d.status ? d : null))
        .catch(() => setExample(null));
    }, 300);
    return () => clearTimeout(t);
  }, [step, policyOk, skills, m.robotType, minFee, maxQuote, margin, spendCap]);

  const valid = [
    /^[\p{L}\p{N} .'-]{2,40}$/u.test(name.trim()),
    Boolean(verified),
    skills.length > 0 && area !== "",
    policyOk,
    walletOk && !check?.takenByOther && !checking,
    Boolean(profile) && ark.onRabdi,
  ];
  // what each finished step chose, shown under its name in the step list
  const summary = [
    name.trim(),
    verified ? m.name : "",
    skills.length ? `${skills.length} skill${skills.length === 1 ? "" : "s"}${area ? ` · ${area}` : ""}` : "",
    policyOk ? `${norm(minFee)}–${norm(maxQuote)} 0G · ${margin}%` : "",
    walletOk ? short(robotWallet) : "",
    "",
  ];
  const go = (n: number) => {
    setDir(n > step ? 1 : -1);
    setError(null);
    setStep(n);
  };

  const publish = async () => {
    if (!profile || !w.account) return;
    setBusy(true);
    setError(null);
    try {
      const args = robotCreateArgs(profile);
      const key = `robot:${profile.robotId}:v${profile.profileVersion}`;
      const res = await ark.publish(key, w.account, args, maxFee);
      setDone({ entityKey: res.entityKey, txHash: res.txHash, robotId: profile.robotId, version: profile.profileVersion });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      ark.refreshBalance(w.account);
    }
  };

  if (done)
    return (
      <motion.div className="reg-done" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 26 }}>
        <span className="reg-done__ok" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="m6 12.5 4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        <h2>{name.trim()} is on Arkiv</h2>
        <dl className="detail-grid">
          <div><dt>Robot id</dt><dd className="mono">{done.robotId}</dd></div>
          <div><dt>Profile version</dt><dd>{done.version}</dd></div>
          <div><dt>Entity key</dt><dd className="mono">{short(done.entityKey)}</dd></div>
          <div><dt>Transaction</dt><dd><a className="link" href={`${ARKIV_EXPLORER}/tx/${done.txHash}`} target="_blank" rel="noreferrer">{short(done.txHash)}</a></dd></div>
        </dl>
        <p className="t-small muted">Arkiv records your wallet as its owner. Only your wallet can update or remove it.</p>
        <div className="btn-row">
          <Link className="btn btn--primary" href="/#top">See it in the network</Link>
          <button className="btn btn--secondary" type="button" onClick={() => { setDone(null); setStep(0); setName(""); setConn(null); setHost(""); }}>Register another robot</button>
        </div>
      </motion.div>
    );

  return (
    <div className="reg">
      <RobotCanvas bounds={scroller} />
      <ol className="reg-rail" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button type="button" className={`${i === step ? "is-on" : ""} ${i < step ? "is-done" : ""}`} disabled={i > step && !valid.slice(0, i).every(Boolean)} onClick={() => go(i)} aria-current={i === step ? "step" : undefined}>
              <span className="reg-rail__n">{i < step ? "✓" : i + 1}</span>
              <span className="reg-rail__txt">
                <span>{s}</span>
                {i < step && summary[i] && <small>{summary[i]}</small>}
              </span>
            </button>
          </li>
        ))}
      </ol>

      <div className="reg-body">
        <div className="reg-panel">
          <div className="reg-scroll" ref={scroller}>
          <AnimatePresence mode="wait" custom={dir}>
            <motion.div
              key={step}
              custom={dir}
              initial={{ opacity: 0, x: dir * 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: dir * -24 }}
              transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
              className="reg-step"
            >
              {step === 0 && (
                <>
                  <h2>What should we call your robot?</h2>
                  <p className="muted">A nickname people see in the marketplace. You can change it later with a new profile version.</p>
                  <label className="field">
                    <span className="t-label muted">Nickname</span>
                    <input autoFocus value={name} maxLength={40} placeholder="Rover 01" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && valid[0] && go(1)} />
                    <span className="field__hint">{name.trim().length}/40 · letters, numbers, spaces and - . &apos;</span>
                  </label>
                </>
              )}

              {step === 1 && (
                <>
                  <h2>Connect your robot</h2>
                  <p className="muted">
                    SEMMAL works with these robots. Start yours, then enter its address on your network. SEMMAL asks it to sign a fresh
                    challenge with its own wallet key and checks which robot it is.
                  </p>
                  <div className="model-grid" aria-label="Supported robots">
                    {HARDWARE.map((x) => (
                      <div key={x.id} className={`model ${model === x.id ? "is-on" : ""}`} aria-current={model === x.id ? "true" : undefined}>
                        <RobotView asset={x.asset} active={model === x.id} className="model__view" />
                        <b>{x.name}</b>
                        <span>{x.maker} · {x.note}</span>
                      </div>
                    ))}
                  </div>
                  <div className="conn">
                    <label className="field conn__field">
                      <span className="t-label muted">Robot address</span>
                      <input className="mono" value={host} spellCheck={false} placeholder="10.71.81.42" onChange={(e) => setHost(e.target.value)} onKeyDown={(e) => e.key === "Enter" && host.trim() && connect()} />
                      <span className="field__hint">The IP the robot printed when you ran pnpm start on it (port 8770 unless you changed it)</span>
                    </label>
                    <button type="button" className="btn btn--primary" disabled={!host.trim() || connecting} onClick={connect}>{connecting ? "Connecting…" : "Connect"}</button>
                  </div>
                  {conn && !conn.ok && <p className="soft-warn">{conn.error}</p>}
                  {conn?.ok && (
                    <div className={`conn__result ${conn.verified ? "is-ok" : "is-bad"}`}>
                      <ul className="conn__checks">
                        <li className={conn.checks.signature ? "ok" : "bad"}>Holds the key of wallet <span className="mono">{short(conn.identity.wallet)}</span></li>
                        <li className={conn.checks.nonce && conn.checks.fresh ? "ok" : "bad"}>Answered this challenge just now (not a replay)</li>
                        <li className={conn.checks.factsHash && conn.checks.modelMatches ? "ok" : "bad"}>Its report matches what it signed</li>
                        <li className={conn.hardware.ok ? "ok" : "bad"}>
                          {conn.hardware.ok ? <>Supported robot: <b>{HARDWARE.find((x) => x.id === (conn.hardware as { model: string }).model)?.name}</b></> : conn.hardware.reason}
                        </li>
                      </ul>
                      {conn.verified && (base ? (
                        <div className="conn__where">
                          <MapView className="conn__map" center={base} robots={[{ id: "me", label: `${name.trim() || "Your robot"} · base, about 1 km`, ...base, active: true }]} fit={[base]} />
                          <p className="t-small muted">Based near {base.lat}, {base.lon} (to about 1 km; the exact spot stays on the robot){radiusKm ? ` · travels up to ${radiusKm} km` : ""}. Customers nearby will see it.</p>
                        </div>
                      ) : (
                        <p className="soft-warn t-small">The robot did not report a base location. Run pnpm setup on it and set one, so customers nearby can find it.</p>
                      ))}
                      <dl className="conn__facts">
                        {Object.entries(conn.identity.facts).map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="mono">{v}</dd></div>)}
                      </dl>
                    </div>
                  )}
                </>
              )}

              {step === 2 && (
                <>
                  <h2>What work can it do?</h2>
                  <p className="muted">Pick every job a {m.name.toLowerCase()} like yours can take, up to four. Customers search by these.</p>
                  <div className="skill-grid">
                    {skillChoices.map((s) => {
                      const on = skills.includes(s.id);
                      return (
                        <button key={s.id} type="button" aria-pressed={on} className={`skill ${on ? "is-on" : ""}`} onClick={() => setSkills((cur) => (on ? cur.filter((x) => x !== s.id) : cur.length >= 4 ? cur : [...cur, s.id]))}>
                          <span className="skill__tick" aria-hidden="true">{on ? "✓" : "+"}</span>
                          <b>{s.label}</b>
                          <span>{s.hint}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="reg-row">
                    <Select
                      label="Where it works (city or region, never an exact site)"
                      value={area}
                      onChange={setArea}
                      groups={SERVICE_AREAS.map((g) => ({ label: g.region, options: g.areas }))}
                      placeholder="Choose a city or region"
                      searchPlaceholder="Search 88 cities and regions"
                    />
                  </div>
                </>
              )}

              {step === 3 && (
                <>
                  <h2>How should it price its work?</h2>
                  <p className="muted">
                    You don&apos;t set a price. For every task the robot adds up what the job really costs (the agents it hires, the 0G
                    inference it needs, its own running time), adds your margin, and stays inside these limits or turns the job down.
                  </p>
                  <div className="policy-grid">
                    <label className="field">
                      <span className="t-label muted">Minimum fee per task</span>
                      <span className="field__money"><input inputMode="decimal" value={minFee} onChange={(e) => setMinFee(e.target.value)} /><small>0G</small></span>
                      <span className="field__hint">It never works for less than this.</span>
                    </label>
                    <label className="field">
                      <span className="t-label muted">Maximum quote</span>
                      <span className="field__money"><input inputMode="decimal" value={maxQuote} onChange={(e) => setMaxQuote(e.target.value)} /><small>0G</small></span>
                      <span className="field__hint">Jobs that cost more than this are declined.</span>
                    </label>
                    <label className="field">
                      <span className="t-label muted">Spend cap per task</span>
                      <span className="field__money"><input inputMode="decimal" value={spendCap} onChange={(e) => setSpendCap(e.target.value)} /><small>0G</small></span>
                      <span className="field__hint">The most it may pay agents and 0G for one job.</span>
                    </label>
                    <label className="range">
                      <span className="t-label muted">Margin on cost</span>
                      <span className="range__val">{margin}<small>%</small></span>
                      <input type="range" min={0} max={100} step={1} value={margin} onChange={(e) => setMargin(Number(e.target.value))} />
                    </label>
                  </div>
                  {!policyOk && <p className="soft-warn">Use amounts like 5 or 12.50, with the maximum at least the minimum.</p>}
                  {policyOk && (
                    <div className="example-quote">
                      <span className="t-label muted">Example: {ROBOT_SKILLS.find((x) => x.id === skills[0])?.label.toLowerCase()}, 4 stops, 160 m, private inference</span>
                      <QuoteBreakdown q={example} />
                    </div>
                  )}
                </>
              )}

              {step === 4 && (
                <>
                  <h2>The robot&apos;s own wallet</h2>
                  <p className="muted">
                    Read from the robot when you connected: it proved it holds this wallet&apos;s key. Its unique id comes from this address.
                    The key never leaves the robot.
                  </p>
                  <div className="pub-checks">
                    <div className={`pub-check ${walletOk ? "is-ok" : ""}`}>
                      <span>Robot wallet</span>
                      <b className="mono">{walletOk ? robotWallet : "Connect the robot first"}</b>
                    </div>
                    <div className={`pub-check ${walletOk && !check?.takenByOther && !checking ? "is-ok" : ""}`}>
                      <span>On Arkiv</span>
                      <b>{!walletOk ? "…" : checking ? "Checking…" : check?.takenByOther ? "Another owner already registered this robot" : `${robotId}${check && check.nextVersion > 1 ? ` · profile version ${check.nextVersion}` : " · new"}`}</b>
                    </div>
                  </div>
                  {sameAsOwner && <p className="soft-warn">The robot&apos;s wallet is the same as your owner wallet. A separate robot wallet keeps the robot&apos;s identity apart from yours.</p>}
                </>
              )}

              {step === 5 && (
                <>
                  <h2>Publish to Arkiv</h2>
                  <p className="muted">Your owner wallet signs one Arkiv entity. You approve the fee here, then confirm in your wallet.</p>
                  <div className="pub-checks">
                    <div className={`pub-check ${w.account ? "is-ok" : ""}`}>
                      <span>Owner wallet</span>
                      {w.account ? <b className="mono">{short(w.account)}</b> : <button className="btn btn--primary" type="button" onClick={w.connect}>Connect wallet</button>}
                    </div>
                    <div className={`pub-check ${ark.onRabdi ? "is-ok" : ""}`}>
                      <span>Network</span>
                      {ark.onRabdi ? <b>Rabdi · {ark.balance !== null ? `${Number(formatEther(ark.balance)).toFixed(4)} tGLM` : "…"}</b> : <button className="btn btn--secondary" type="button" onClick={ark.switchToRabdi} disabled={!w.account}>Switch to Rabdi</button>}
                    </div>
                    <div className="pub-check">
                      <span>Fee cap</span>
                      <label className="fee-inline"><input inputMode="decimal" value={maxFee} onChange={(e) => setMaxFee(e.target.value)} aria-label="Maximum fee in tGLM" /> tGLM</label>
                    </div>
                  </div>
                  {ark.onRabdi && ark.balance === 0n && (
                    <p className="soft-warn">This wallet has no test tGLM. <a className="link" href="https://hub.arkiv.network/faucet" target="_blank" rel="noreferrer">Get some at the faucet</a>, then come back.</p>
                  )}
                  {profile && (
                    <details className="json-peek">
                      <summary><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7.5 5 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>See exactly what goes on Arkiv</summary>
                      <pre className="mono">{JSON.stringify(profile, null, 2)}</pre>
                    </details>
                  )}
                  {ark.approval && (
                    <ApprovalCard
                      what={`Robot profile · ${ark.approval.key}`}
                      account={w.account}
                      gas={ark.approval.gas}
                      gasPrice={ark.approval.gasPrice}
                      maximumCostWei={ark.approval.maximumCostWei}
                      onApprove={() => ark.approval!.resolve(true)}
                      onCancel={() => ark.approval!.resolve(false)}
                    />
                  )}
                </>
              )}
            </motion.div>
          </AnimatePresence>

          {error && <p className="soft-warn" role="status">{error}</p>}
          </div>

          <div className="reg-nav">
            <span className="reg-nav__count muted t-small">Step {step + 1} of {STEPS.length}</span>
            <span className="reg-nav__btns">
            {step > 0 && <button type="button" className="btn btn--secondary" onClick={() => go(step - 1)} disabled={busy}>Back</button>}
            {step < 5 ? (
              <button type="button" className="btn btn--primary" disabled={!valid[step]} onClick={() => go(step + 1)}>Continue</button>
            ) : (
              <button type="button" className="btn btn--primary" disabled={!valid[5] || busy} onClick={publish}>{busy ? "Publishing…" : "Publish robot"}</button>
            )}
            </span>
          </div>
        </div>

        <aside className="reg-preview" aria-label="Preview">
          <span className="t-label muted">Preview</span>
          <div className="robot-card">
            <RobotSolo asset={m.asset} active className="robot-card__view" zoom={1.05} />
            <h3>{name.trim() || "Your robot"}</h3>
            <p className="muted t-small">{m.name}</p>
            <div className="robot-card__tags">
              {skills.map((s) => <span key={s} className="chip chip--ok">{ROBOT_SKILLS.find((x) => x.id === s)?.label}</span>)}
              {skills.length === 0 && <span className="chip">No skills yet</span>}
            </div>
            <dl>
              <div><dt>Pricing</dt><dd>Quoted per task, {norm(minFee) || "…"} to {norm(maxQuote) || "…"} 0G</dd></div>
              <div><dt>Margin</dt><dd>{margin}% on cost</dd></div>
              <div><dt>Area</dt><dd>{area || "—"}</dd></div>
              <div><dt>Robot id</dt><dd className="mono">{robotId || "from its wallet"}</dd></div>
              <div><dt>Robot wallet</dt><dd className="mono">{walletOk ? short(robotWallet) : "—"}</dd></div>
              <div><dt>Owner</dt><dd className="mono">{w.account ? short(w.account) : "connect at the last step"}</dd></div>
            </dl>

          </div>
        </aside>
      </div>
    </div>
  );
}
