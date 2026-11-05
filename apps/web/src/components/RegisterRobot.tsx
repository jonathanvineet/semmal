"use client";
/**
 * Register a robot on Arkiv: nickname -> model -> skills -> robot wallet -> review and publish.
 * The robot's id is derived from its own wallet (one robot, one id). The owner's wallet signs the
 * Arkiv entity; no private key is ever entered.
 */
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { formatEther, getAddress, isAddress } from "viem";
import { ROBOT_MODELS, ROBOT_SKILLS, RobotProfile, robotIdFromWallet, type RobotProfile as TRobot } from "@semmal/contracts";
import { robotCreateArgs } from "@semmal/arkiv-adapter/browser";
import { useWallet } from "@/lib/wallet";
import { useArkivWriter } from "@/lib/arkiv-writer";
import { ARKIV_EXPLORER } from "@/lib/api";

const STEPS = ["Nickname", "Model", "Skills", "Robot wallet", "Publish"] as const;
const AREAS = ["warehouse-a", "warehouse-b"] as const;
type Check = { robotId: string; takenByOther: boolean; existing: { entityKey: string; creator: string; profileVersion: number }[]; nextVersion: number };

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function RoverGlyph({ model }: { model: string }) {
  const off = model !== "semmal-rover-sim";
  return (
    <svg viewBox="0 0 120 80" className={`rover ${off ? "is-off" : ""}`} aria-hidden="true">
      <rect x="22" y="30" width="76" height="30" rx="14" className="rover__body" />
      <rect x="30" y="24" width="60" height="10" rx="5" className="rover__deck" />
      <circle cx="60" cy="18" r="7" className="rover__lidar" />
      <circle cx="34" cy="62" r="9" className="rover__wheel" />
      <circle cx="86" cy="62" r="9" className="rover__wheel" />
      <rect x="40" y="42" width="40" height="4" rx="2" className="rover__light" />
    </svg>
  );
}

export function RegisterRobot() {
  const w = useWallet();
  const ark = useArkivWriter();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [name, setName] = useState("");
  const [model, setModel] = useState<string>("semmal-rover-sim");
  const [skills, setSkills] = useState<string[]>(["warehouse.inspection"]);
  const [price, setPrice] = useState(12.5);
  const [area, setArea] = useState<string>(AREAS[0]);
  const [robotWallet, setRobotWallet] = useState("");
  const [check, setCheck] = useState<Check | null>(null);
  const [checking, setChecking] = useState(false);
  const [maxFee, setMaxFee] = useState("0.01");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ entityKey: string; txHash: string; robotId: string; version: number } | null>(null);

  const m = ROBOT_MODELS.find((x) => x.id === model)!;
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
      capabilities: skills as TRobot["capabilities"],
      rosInterfaceVersion: "0.1.0",
      profileVersion: check?.nextVersion ?? 1,
      serviceArea: area,
      price: { amount: price.toFixed(2), token: "USDC", unit: "task" as const },
    };
    const r = RobotProfile.safeParse(draft);
    return r.success ? r.data : null;
  }, [walletOk, w.account, robotId, robotWallet, name, model, m, skills, check, area, price]);

  const valid = [
    /^[\p{L}\p{N} .'-]{2,40}$/u.test(name.trim()),
    m.supported,
    skills.length > 0,
    walletOk && !check?.takenByOther && !checking,
    Boolean(profile) && ark.onRabdi,
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
          <button className="btn btn--secondary" type="button" onClick={() => { setDone(null); setStep(0); setName(""); setRobotWallet(""); }}>Register another robot</button>
        </div>
      </motion.div>
    );

  return (
    <div className="reg">
      <ol className="reg-rail" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button type="button" className={`${i === step ? "is-on" : ""} ${i < step ? "is-done" : ""}`} disabled={i > step && !valid.slice(0, i).every(Boolean)} onClick={() => go(i)} aria-current={i === step ? "step" : undefined}>
              <span className="reg-rail__n">{i < step ? "✓" : i + 1}</span>
              <span>{s}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="reg-body">
        <div className="reg-panel">
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
                  <h2>Which model is it?</h2>
                  <p className="muted">The platform decides its sensors and how SEMMAL can drive it safely.</p>
                  <div className="model-grid" role="radiogroup" aria-label="Robot model">
                    {ROBOT_MODELS.map((x) => (
                      <button key={x.id} type="button" role="radio" aria-checked={model === x.id} disabled={!x.supported} className={`model ${model === x.id ? "is-on" : ""}`} onClick={() => setModel(x.id)}>
                        <RoverGlyph model={x.id} />
                        <b>{x.name}</b>
                        <span>{x.note}</span>
                        {!x.supported && <span className="model__soon">Coming later</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {step === 2 && (
                <>
                  <h2>What work can it do?</h2>
                  <p className="muted">Pick every job it can take. Customers and the marketplace search by these.</p>
                  <div className="skill-grid">
                    {ROBOT_SKILLS.map((s) => {
                      const on = skills.includes(s.id);
                      return (
                        <button key={s.id} type="button" aria-pressed={on} className={`skill ${on ? "is-on" : ""}`} onClick={() => setSkills((cur) => (on ? cur.filter((x) => x !== s.id) : [...cur, s.id]))}>
                          <span className="skill__tick" aria-hidden="true">{on ? "✓" : "+"}</span>
                          <b>{s.label}</b>
                          <span>{s.hint}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="reg-row">
                    <label className="range">
                      <span className="t-label muted">Price per task</span>
                      <span className="range__val">{price.toFixed(2)} <small>USDC</small></span>
                      <input type="range" min={1} max={60} step={0.5} value={price} onChange={(e) => setPrice(Number(e.target.value))} />
                    </label>
                    <label className="field">
                      <span className="t-label muted">Service area (coarse, never an exact location)</span>
                      <select value={area} onChange={(e) => setArea(e.target.value)}>
                        {AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </label>
                  </div>
                </>
              )}

              {step === 3 && (
                <>
                  <h2>The robot&apos;s own wallet</h2>
                  <p className="muted">
                    Paste the public address of the wallet that belongs to this robot. Its unique id comes from this address. A separate
                    account in your wallet works well. Never paste a private key.
                  </p>
                  <label className="field">
                    <span className="t-label muted">Robot wallet address</span>
                    <input className="mono" value={robotWallet} spellCheck={false} placeholder="0x…" onChange={(e) => setRobotWallet(e.target.value.trim())} />
                    <span className="field__hint">
                      {!robotWallet ? "40 hex characters after 0x" : !walletOk ? "That is not a valid address" : checking ? "Checking Arkiv…" : check?.takenByOther ? "Another owner already registered this robot wallet" : `Robot id ${robotId}${check && check.nextVersion > 1 ? ` · this will be profile version ${check.nextVersion}` : " · new on Arkiv"}`}
                    </span>
                  </label>
                  {sameAsOwner && <p className="soft-warn">This is the same as your owner wallet. It works, but a separate robot wallet keeps the robot&apos;s identity apart from yours.</p>}
                </>
              )}

              {step === 4 && (
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
                      <summary>See exactly what goes on Arkiv</summary>
                      <pre className="mono">{JSON.stringify(profile, null, 2)}</pre>
                    </details>
                  )}
                  {ark.approval && (
                    <div className="approve" role="alertdialog" aria-labelledby="ap-h">
                      <h3 id="ap-h" className="t-card">Approve this write</h3>
                      <p className="muted t-small">Maximum fee {formatEther(ark.approval.maximumCostWei)} tGLM · gas {ark.approval.gas.toString()}</p>
                      <div className="btn-row">
                        <button className="btn btn--primary" type="button" onClick={() => ark.approval!.resolve(true)}>Approve and open wallet</button>
                        <button className="btn btn--secondary" type="button" onClick={() => ark.approval!.resolve(false)}>Cancel</button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          </AnimatePresence>

          {error && <p className="soft-warn" role="status">{error}</p>}

          <div className="reg-nav">
            {step > 0 ? <button type="button" className="btn btn--secondary" onClick={() => go(step - 1)} disabled={busy}>Back</button> : <span />}
            {step < 4 ? (
              <button type="button" className="btn btn--primary" disabled={!valid[step]} onClick={() => go(step + 1)}>Continue</button>
            ) : (
              <button type="button" className="btn btn--primary" disabled={!valid[4] || busy} onClick={publish}>{busy ? "Publishing…" : "Publish robot"}</button>
            )}
          </div>
        </div>

        <aside className="reg-preview" aria-label="Preview">
          <span className="t-label muted">Preview</span>
          <div className="robot-card">
            <RoverGlyph model={model} />
            <h3>{name.trim() || "Your robot"}</h3>
            <p className="muted t-small">{m.name}</p>
            <div className="robot-card__tags">
              {skills.map((s) => <span key={s} className="chip chip--ok">{ROBOT_SKILLS.find((x) => x.id === s)?.label}</span>)}
              {skills.length === 0 && <span className="chip">No skills yet</span>}
            </div>
            <dl>
              <div><dt>Price</dt><dd>{price.toFixed(2)} USDC per task</dd></div>
              <div><dt>Area</dt><dd>{area}</dd></div>
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
