"use client";
/** Link a robot to the gateway, watch it live, and send it a test task. Owner wallet only. */
import { useCallback, useEffect, useRef, useState } from "react";
import { copyText, selectText } from "@/lib/clipboard";

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
  const [copied, setCopied] = useState<"" | "yes" | "manual">("");
  const tokenEl = useRef<HTMLPreElement>(null);

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
      setCopied("");
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
  const releaseHold = async () => {
    try {
      await call("POST", `/api/robots/${robotId}/release-hold`);
      setMsg("Asked the robot to release its hold. It checks its own state first; its answer appears in the log below.");
      load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const sendTask = async (skill: string) => {
    try {
      const d = await call("POST", `/api/robots/${robotId}/tasks`, { skill, waypoints: 3, distanceM: 120, privacy: "private" });
      setMsg(`Sent ${d.taskId}. The robot's answer appears in the log.`);
      load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  // the robot PC must reach this machine over the network, so never "localhost"
  const host = hosts[0] ?? "<this-mac-ip>";
  // the robot saves the token in its own profile (pnpm run setup <name> --token on the robot PC; hidden input)
  const cmd = token ? token : "";
  const copy = async () => {
    if (await copyText(cmd)) return setCopied("yes");
    // nothing reached the clipboard: select the token so it can be copied by hand, and say so
    selectText(tokenEl.current);
    setCopied("manual");
  };

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
          {live?.online && live.safetyState === "STOPPING" && (
            <button type="button" className="btn btn--secondary btn--sm" onClick={releaseHold} title="The robot is holding still after a stopped task. It releases only if nothing is running; an emergency stop needs the operator at the robot.">Release hold</button>
          )}
          {live?.online && capabilities.slice(0, 4).map((c) => (
            <button key={c} type="button" className="btn btn--primary btn--sm" onClick={() => sendTask(c)}>Send task: {c}</button>
          ))}
        </span>
      </div>

      {token && (
        <div className="rl__token">
          <p className="t-small"><b>Shown once.</b> On the robot PC, in services/robot-master, run <span className="mono">pnpm run setup &lt;name&gt; --token</span> and paste this token (only the token) when it asks. A running <span className="mono">pnpm start &lt;name&gt;</span> picks it up and links within seconds. The token is revocable and not a wallet key; anyone with it can speak as this robot until you revoke it.</p>
          {hosts.length === 0 && <p className="t-small soft-warn">This API only listens on this machine. Set <span className="mono">API_HOST=0.0.0.0</span> in .env and restart it, then click New token, so the robot PC can reach it.</p>}
          {hosts.length > 0 && <p className="t-small muted">When setup asks for the platform address, use <span className="mono">http://{host}:{port}</span>{hosts.length > 1 ? ` (other addresses for this machine: ${hosts.slice(1).join(", ")})` : ""}.</p>}
          <pre className="mono" ref={tokenEl}>{cmd}</pre>
          <button type="button" className="btn btn--secondary btn--sm" onClick={copy}>{copied === "yes" ? "Copied" : "Copy token"}</button>
          {copied === "manual" && <p className="t-small soft-warn">This browser blocked copying on this page. The token is selected above: press Ctrl+C (Cmd+C on a Mac).</p>}
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
