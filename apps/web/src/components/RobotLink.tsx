"use client";
/** Link a robot to the gateway, watch it live, and send it a test task. Owner wallet only. */
import { useCallback, useEffect, useState } from "react";

type Live = {
  robotId: string;
  linked: boolean;
  online: boolean;
  lastSeen?: string;
  softwareVersion?: string;
  batteryPct?: number;
  safetyState?: string;
  zone?: string;
  availability?: string;
  events: { at: string; kind: string; detail: string }[];
};

const ago = (iso?: string) => {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
};

export function RobotLink({ robotId, capabilities }: { robotId: string; capabilities: string[] }) {
  const [live, setLive] = useState<Live | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [hosts, setHosts] = useState<string[]>([]);
  const [port, setPort] = useState(3001);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/robots/${robotId}/live`, { credentials: "same-origin" });
    if (r.ok) setLive(await r.json());
  }, [robotId]);
  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  const call = async (method: "POST" | "DELETE", path: string, body?: unknown) => {
    setMsg(null);
    const r = await fetch(path, { method, credentials: "same-origin", headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error ?? `Failed (${r.status})`);
    return d;
  };

  const link = async () => {
    try {
      const d = await call("POST", `/api/robots/${robotId}/link`);
      setToken(d.token);
      setHosts(d.platformHosts ?? []);
      setPort(d.port ?? 3001);
      setCopied(false);
      load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const revoke = async () => {
    try {
      await call("DELETE", `/api/robots/${robotId}/link`);
      setToken(null);
      setMsg("Link revoked. The robot was disconnected and its token no longer works.");
      load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const sendTask = async () => {
    try {
      const d = await call("POST", `/api/robots/${robotId}/tasks`, { skill: capabilities[0], waypoints: 3, distanceM: 120, privacy: "private" });
      setMsg(`Sent ${d.taskId}. The robot's answer appears in the log.`);
      load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  // the robot PC must reach this machine over the network, so never "localhost"
  const host = hosts[0] ?? "<this-mac-ip>";
  const cmd = token
    ? [
        "cd services/robot-master",
        "pnpm install",
        "[ -f ~/.semmal/robot-key ] || pnpm keygen   # once; the address must match this robot's wallet on Arkiv",
        "cat > .env.robot <<'EOF'",
        `SEMMAL_ROBOT_ID=${robotId}`,
        `SEMMAL_LINK_TOKEN=${token}`,
        `SEMMAL_PLATFORM_URL=http://${host}:${port}`,
        `SEMMAL_GATEWAY_URL=ws://${host}:${port}/api/gateway`,
        "SEMMAL_LOCAL_API=http://127.0.0.1:8765",
        "ARKIV_ACCESS_KEY=",
        "EOF",
        'echo "SEMMAL_DATA_DIR=$(cd ../.. && pwd)/data" >> .env.robot',
        "pnpm start",
      ].join("\n")
    : "";

  return (
    <div className="rl">
      <div className="rl__status">
        <span className={`dot ${live?.online ? "dot--ok" : live?.linked ? "dot--warn" : "dot--bad"}`} aria-hidden="true" />
        <b>{live?.online ? "Online" : live?.linked ? "Linked, not connected" : "Not linked"}</b>
        {live?.online && (
          <span className="muted t-small">
            {live.safetyState} · battery {live.batteryPct}% · {live.availability}{live.zone ? ` · ${live.zone}` : ""} · seen {ago(live.lastSeen)}
          </span>
        )}
        <span className="rl__actions">
          <button type="button" className="btn btn--secondary btn--sm" onClick={link}>{live?.linked ? "New token" : "Link robot"}</button>
          {live?.linked && <button type="button" className="btn btn--secondary btn--sm" onClick={revoke}>Revoke</button>}
          {live?.online && <button type="button" className="btn btn--primary btn--sm" onClick={sendTask}>Send a test task</button>}
        </span>
      </div>

      {token && (
        <div className="rl__token">
          <p className="t-small"><b>Shown once.</b> Run this in the repo on the robot PC, with the ROS stack started with <span className="mono">ROBOT_ID={robotId}</span>. The token is revocable and not a wallet key; anyone with it can speak as this robot until you revoke it.</p>
          {hosts.length === 0 && <p className="t-small soft-warn">This API only listens on this machine. Set <span className="mono">API_HOST=0.0.0.0</span> in .env and restart it, then click New token, so the robot PC can reach it.</p>}
          {hosts.length > 1 && <p className="t-small muted">Other addresses for this machine: {hosts.slice(1).join(", ")}</p>}
          <pre className="mono">{cmd}</pre>
          <button type="button" className="btn btn--secondary btn--sm" onClick={async () => { await navigator.clipboard.writeText(cmd); setCopied(true); }}>{copied ? "Copied" : "Copy command"}</button>
        </div>
      )}

      {msg && <p className="notice t-small">{msg}</p>}

      {live && live.events.length > 0 && (
        <ol className="rl__log">
          {live.events.slice(0, 8).map((e, i) => (
            <li key={i}><span className="mono muted">{e.at.slice(11, 19)}</span><span className={`rl__kind rl__kind--${e.kind}`}>{e.kind}</span><span>{e.detail}</span></li>
          ))}
        </ol>
      )}
    </div>
  );
}
