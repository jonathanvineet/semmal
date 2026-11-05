"use client";
import { motion } from "motion/react";
import { useApi, type Listing, type RobotProfile, type Status } from "@/lib/api";
import { ProvenanceBadge } from "./ui/Provenance";
import { RegistryLine } from "./Marketplace";
import { IconChain, IconLock, IconShield } from "./ui/Icons";

const sensorLabel: Record<string, string> = {
  "lidar-2d": "2D lidar",
  "rgb-camera": "RGB camera",
  imu: "IMU",
  "wheel-encoders": "Wheel encoders",
  bumper: "Bumper",
  battery: "Battery monitor",
};

export function RobotsSection() {
  const { data, error } = useApi<Listing<RobotProfile>>("/api/robots");
  return (
    <section id="robots" className="section" style={{ ["--h" as string]: 1 }} aria-labelledby="robots-h">
      <div className="wrap">
        <div className="section-head section-head--split">
          <div>
            <h2 id="robots-h">Robots for hire <span className="muted">from the Arkiv registry</span></h2>
          </div>
          <RegistryLine listing={data} />
        </div>
        {error && <p className="notice">{error}</p>}
        <div className="robot-list">
          {data?.items.map((r) => (
            <motion.article key={r.data.robotId} className="robot-row" whileHover={{ y: -2 }} transition={{ duration: 0.14 }}>
              <div className="robot-row__id">
                <h3 className="t-card">{r.data.displayName}</h3>
                <span className="mono muted t-small">{r.data.robotId} · profile v{r.data.profileVersion}</span>
                <ProvenanceBadge provenance={r.provenance} entityKey={r.entityKey} />
              </div>
              <dl className="robot-row__facts">
                <div><dt>Base</dt><dd>{r.data.hardware.base}</dd></div>
                <div><dt>Sensors</dt><dd>{r.data.hardware.sensors.map((s) => sensorLabel[s] ?? s).join(", ")}</dd></div>
                <div><dt>Tasks</dt><dd className="mono">{r.data.capabilities.join(" · ")}</dd></div>
                <div><dt>Service area</dt><dd>{r.data.serviceArea}</dd></div>
              </dl>
              <div className="robot-row__price">
                <span className="t-stat">{r.data.price.amount}</span>
                <span className="muted t-small">{r.data.price.token} per {r.data.price.unit}</span>
                {r.data.hardware.simulated && <span className="badge badge--sim">Gazebo simulation</span>}
              </div>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function RegistrySection() {
  const { data, error } = useApi<Status>("/api/integrations/status");
  const z = data?.zerog;
  const a = data?.arkiv;
  return (
    <section id="registry" className="section" style={{ ["--h" as string]: 1 }} aria-labelledby="registry-h">
      <div className="wrap">
        <div className="section-head">
          <h2 id="registry-h">Live integrations <span className="muted">read from the API, not hard-coded</span></h2>
        </div>
        {error && <p className="notice">{error}</p>}
        <div className="grid integ-grid">
          <article className="card integ span-4">
            <span className="integ__icon"><IconChain /></span>
            <h3 className="t-card">Arkiv registry</h3>
            <dl>
              <div><dt>Network</dt><dd>{a ? a.network : "…"}</dd></div>
              <div><dt>Chain ID</dt><dd className="mono">{a?.chainId ?? "—"}</dd></div>
              <div><dt>RPC</dt><dd><Status ok={a?.reachable} yes="reachable" no="unreachable" /></dd></div>
              <div><dt>Access key</dt><dd><Status ok={a?.accessKeyConfigured} yes="configured" no="public endpoint" warn /></dd></div>
              <div><dt>Writer</dt><dd><Status ok={a?.writerConfigured} yes="configured" no="read-only" warn /></dd></div>
            </dl>
          </article>
          <article className="card integ span-4">
            <span className="integ__icon"><IconLock /></span>
            <h3 className="t-card">0G private inference</h3>
            <dl>
              <div><dt>Router key</dt><dd><Status ok={z?.configured} yes="configured" no="not set: no inference" warn /></dd></div>
              <div><dt>Trust mode</dt><dd className="mono">{z?.requiredTrustMode ?? "—"}</dd></div>
              <div><dt>Vision model</dt><dd className="mono">{z?.visionModel ? `${z.visionModel.id} · ${z.visionModel.status}` : "—"}</dd></div>
              <div><dt>Text model</dt><dd className="mono">{z?.textModel ? `${z.textModel.id} · ${z.textModel.status}` : "—"}</dd></div>
            </dl>
            {z?.visionModel?.reason || z?.catalogError ? <p className="t-small muted">{z?.visionModel?.reason ?? z?.catalogError}</p> : null}
          </article>
          <article className="card integ span-4">
            <span className="integ__icon"><IconShield /></span>
            <h3 className="t-card">Local safety</h3>
            <dl>
              <div><dt>Emergency stop</dt><dd>on the robot, no network</dd></div>
              <div><dt>AI can clear a stop</dt><dd>never</dd></div>
              <div><dt>Mode</dt><dd className="mono">{data?.mode ?? "—"}</dd></div>
            </dl>
            <p className="t-small muted">The 0G call is advisory. If it fails, the robot holds position; no answer is invented.</p>
          </article>
        </div>
      </div>
    </section>
  );
}

function Status({ ok, yes, no, warn }: { ok?: boolean; yes: string; no: string; warn?: boolean }) {
  if (ok === undefined) return <span className="muted">…</span>;
  return (
    <span className="status">
      <span className={`dot ${ok ? "dot--ok" : warn ? "dot--warn" : "dot--bad"}`} aria-hidden="true" />
      {ok ? yes : no}
    </span>
  );
}
