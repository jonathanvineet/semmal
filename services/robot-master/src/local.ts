/** Client for the robot-host gateway node (semmal_gateway, 127.0.0.1 only). */
/** A stop the robot can tidy itself: where to approach, where to drop what it picks up (null: a wipe). */
export type ClearingSpot = { approach: string; dropAt: string | null; pick: string[]; wipe: string[] };
export type LocalState = { safetyState: string; batteryPct: number; zone: string; availability: string; executor: boolean; missionPhase: string; activeTask: string | null; hold: boolean; world?: string | null; waypoints?: string[]; clearing?: Record<string, ClearingSpot> };
export type ClearStep = "reset" | "pick" | "drop" | "wipe";
export type ClearResult = { ok: boolean; moved: string[]; failed: string[]; error?: string };
export type MissionResult = { success: boolean; outcome: string; message: string; reached: string[]; keyframePaths: string[] };

export interface LocalApi {
  state(): Promise<LocalState>;
  startMission(goal: { taskId: string; episodeId: string; waypoints: string[]; captureKeyframe: boolean; maxSpeed?: number; dwellS?: number }): Promise<{ accepted: boolean; message: string }>;
  waitMission(timeoutMs: number): Promise<MissionResult | null>;
  cancel(): Promise<void>;
  hold(on: boolean): Promise<void>;
  /** One allowlisted clearing step (the gateway checks the robot is at the spot and moves only listed props). */
  clear?(stop: string, step: ClearStep): Promise<ClearResult>;
  keyframe(path: string): Promise<{ dataUrl: string; width: number; height: number }>;
}

export function httpLocal(base: string): LocalApi {
  const call = async (path: string, init?: RequestInit) => {
    const r = await fetch(`${base}${path}`, { ...init, headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(8000) });
    const d = await r.json();
    return { ok: r.ok, d };
  };
  return {
    async state() {
      return (await call("/state")).d;
    },
    async startMission(goal) {
      return (await call("/mission", { method: "POST", body: JSON.stringify(goal) })).d;
    },
    async waitMission(timeoutMs) {
      const end = Date.now() + timeoutMs;
      // the result appears once the action finishes; poll until then
      await new Promise((r) => setTimeout(r, 500));
      while (Date.now() < end) {
        const { d } = await call("/mission");
        if (!d.active && d.result) return d.result as MissionResult;
        await new Promise((r) => setTimeout(r, 1000));
      }
      return null;
    },
    async cancel() {
      await call("/mission/cancel", { method: "POST", body: "{}" });
    },
    async hold(on) {
      await call("/hold", { method: "POST", body: JSON.stringify({ hold: on }) });
    },
    async clear(stop, step) {
      const r = await fetch(`${base}/clear`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stop, step }), signal: AbortSignal.timeout(30_000) });
      const d = await r.json().catch(() => ({}));
      return { ok: r.ok, moved: d.moved ?? [], failed: d.failed ?? [], error: d.error };
    },
    async keyframe(path) {
      const { ok, d } = await call(`/keyframe?path=${encodeURIComponent(path)}`);
      if (!ok) throw new Error(d.error ?? "keyframe unavailable");
      return d;
    },
  };
}
