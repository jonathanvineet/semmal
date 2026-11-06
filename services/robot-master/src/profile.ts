/**
 * Robot profiles on this robot PC: one folder per robot, owner-only.
 *
 *   ~/.semmal/robots/<name>/robot-key   the robot's device key (mode 600), generated here or imported
 *   ~/.semmal/robots/<name>/robot.env   its settings (mode 600): hardware, platform, link token, Arkiv key
 *
 * Nothing here is ever sent anywhere, printed, or committed. The platform only ever sees the address.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const ROBOTS_DIR = process.env.SEMMAL_ROBOTS_DIR || join(homedir(), ".semmal", "robots");
export const NAME_RE = /^[a-z][a-z0-9-]{1,30}$/;

export function paths(name: string) {
  if (!NAME_RE.test(name)) throw new Error(`robot name must be lowercase letters, digits or - (2-31 chars), e.g. house`);
  const dir = join(ROBOTS_DIR, name);
  return { dir, env: join(dir, "robot.env"), key: join(dir, "robot-key") };
}

export function readEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

export function writeEnv(path: string, values: Record<string, string>, header: string) {
  mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
  const body = [header, ...Object.entries(values).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v.replace(/[\r\n]/g, "")}`)].join("\n") + "\n";
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, body, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

/** Load a robot's settings into process.env. Returns false when the robot has not been set up. */
export function loadProfile(name: string) {
  const p = paths(name);
  if (!existsSync(p.env) || !existsSync(p.key)) return false;
  Object.assign(process.env, readEnv(p.env), { SEMMAL_ROBOT_NAME: name, SEMMAL_ROBOT_KEY_FILE: p.key });
  return true;
}
