import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { cleanPasted, isLinkToken, normalisePlatform, parseFieldFlags, profileComplete } from "./setup";

// shaped exactly like the API issues them (apps/api/src/gateway.ts)
const TOKEN = `slk_${randomBytes(32).toString("base64url")}`;
import { generateDeviceKey } from "./device";
import { readEnv, writeEnv } from "./profile";

test("platform address: keeps an explicit port, adds the API default to plain http, leaves https tunnels on 443, rejects paths", () => {
  assert.deepEqual(normalisePlatform("http://172.20.10.2"), { url: "http://172.20.10.2:3001", addedPort: true });
  assert.deepEqual(normalisePlatform("http://172.20.10.2:3001/"), { url: "http://172.20.10.2:3001", addedPort: false });
  assert.deepEqual(normalisePlatform("https://api.example.org:8443"), { url: "https://api.example.org:8443", addedPort: false });
  // an https tunnel already listens on 443; adding :3001 made the link fail with HTTP 404
  assert.deepEqual(normalisePlatform("https://7w7685tt-3001.inc1.devtunnels.ms/"), { url: "https://7w7685tt-3001.inc1.devtunnels.ms", addedPort: false });
  assert.equal(normalisePlatform("172.20.10.2:3001"), null); // scheme required
  assert.equal(normalisePlatform("http://host:3001/api"), null);
  assert.equal(normalisePlatform("http://host:70000"), null);
});

test("pasted secrets lose bracketed-paste markers, control characters and whitespace", () => {
  const key = "0x" + "ab".repeat(32);
  assert.equal(cleanPasted(`\x1b[200~${key}\x1b[201~`), key);
  assert.equal(cleanPasted(` ${key}\r\n`), key);
  assert.equal(cleanPasted("slk_abc def"), "slk_abcdef");
});

test("link tokens: the API's format passes; a pasted command, a bare word or a truncated token does not", () => {
  assert.equal(TOKEN.length, 47);
  assert.equal(isLinkToken(TOKEN), true);
  assert.equal(isLinkToken(cleanPasted("pnpm run setup house --platform --token")), false);
  assert.equal(isLinkToken("token"), false);
  assert.equal(isLinkToken("slk_abc"), false);
  assert.equal(isLinkToken(TOKEN.slice(4)), false);
});

test("field flags select only those settings; unknown flags are refused", () => {
  assert.equal(parseFieldFlags([]), null);
  assert.deepEqual(parseFieldFlags(["--token"]), { all: false, fields: ["token"] });
  assert.deepEqual(parseFieldFlags(["--platform", "--token", "--token"]), { all: false, fields: ["platform", "token"] });
  assert.deepEqual(parseFieldFlags(["--all"]), { all: true, fields: [] });
  assert.throws(() => parseFieldFlags(["--wallet"]), /unknown option/);
  assert.throws(() => parseFieldFlags(["token"]), /unknown option/);
});

test("a profile is complete without a link token, but not without hardware, base, platform or key", () => {
  const full = { SEMMAL_HARDWARE: "create3", SEMMAL_BASE_LAT: "1", SEMMAL_BASE_LON: "2", SEMMAL_PLATFORM_URL: "http://h:3001" };
  assert.equal(profileComplete(full, true), true);
  assert.equal(profileComplete(full, false), false);
  assert.equal(profileComplete({ ...full, SEMMAL_PLATFORM_URL: "" }, true), false);
});

// ---- the real script, end to end, with piped answers and a throwaway robots folder

const SAVED = {
  SEMMAL_HARDWARE: "create3",
  SEMMAL_BASE_LAT: "19.0748",
  SEMMAL_BASE_LON: "72.8856",
  SEMMAL_SERVICE_RADIUS_KM: "5",
  SEMMAL_PLATFORM_URL: "http://172.20.10.2",
  SEMMAL_GATEWAY_URL: "ws://172.20.10.2/api/gateway",
  SEMMAL_LOCAL_API: "http://127.0.0.1:8765",
  SEMMAL_DATA_DIR: "/tmp/semmal-test-data",
  ARKIV_ACCESS_KEY: "",
  SEMMAL_LINK_TOKEN: "",
};

function withRobot(fn: (dir: string, envFile: string, keyFile: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "semmal-setup-"));
  const robot = join(dir, "house");
  const keyFile = join(robot, "robot-key");
  const envFile = join(robot, "robot.env");
  generateDeviceKey(keyFile);
  writeEnv(envFile, SAVED, "# test");
  try {
    fn(dir, envFile, keyFile);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runSetup(robotsDir: string, args: string[], input: string) {
  const r = spawnSync(process.execPath, ["--import", "tsx", join(import.meta.dirname, "setup.ts"), "house", ...args], {
    input,
    encoding: "utf8",
    env: { ...process.env, SEMMAL_ROBOTS_DIR: robotsDir },
    timeout: 30_000,
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

test("--token asks only for the token and leaves every other setting as it was", () => {
  withRobot((dir, envFile, keyFile) => {
    const keyBefore = readFileSync(keyFile, "utf8");
    const out = runSetup(dir, ["--token"], `\x1b[200~${TOKEN}\x1b[201~\n`);
    assert.match(out, /Link token \(hidden\)/);
    assert.doesNotMatch(out, /Which hardware|Base location|Platform address|Arkiv access key/);
    assert.ok(!out.includes(TOKEN)); // never echoed
    const after = readEnv(envFile);
    assert.equal(after.SEMMAL_LINK_TOKEN, TOKEN);
    for (const k of ["SEMMAL_HARDWARE", "SEMMAL_BASE_LAT", "SEMMAL_BASE_LON", "SEMMAL_SERVICE_RADIUS_KM", "SEMMAL_PLATFORM_URL", "ARKIV_ACCESS_KEY"] as const)
      assert.equal(after[k], SAVED[k], k);
    assert.equal(readFileSync(keyFile, "utf8"), keyBefore); // the device key is never touched
    assert.equal(statSync(envFile).mode & 0o777, 0o600);
  });
});

test("a pasted command at the token prompt is refused and asked again; nothing wrong is saved", () => {
  withRobot((dir, envFile) => {
    const out = runSetup(dir, ["--token"], `pnpm run setup house --platform --token\n${TOKEN}\n`);
    assert.match(out, /That is not a link token \(34 characters, and it looks like a command\)/);
    assert.equal(readEnv(envFile).SEMMAL_LINK_TOKEN, TOKEN);
  });
  withRobot((dir, envFile) => {
    runSetup(dir, ["--token"], "pnpm run setup house --token\n\n"); // wrong paste, then Enter = keep
    assert.equal(readEnv(envFile).SEMMAL_LINK_TOKEN, SAVED.SEMMAL_LINK_TOKEN);
  });
});

test("the menu changes only the picked setting; a portless platform address gets :3001 and a matching gateway", () => {
  withRobot((dir, envFile) => {
    const out = runSetup(dir, [], "3\nhttp://172.20.10.9\n");
    assert.match(out, /Change which\?/);
    assert.match(out, /using http:\/\/172\.20\.10\.9:3001/);
    assert.doesNotMatch(out, /Which hardware|Base location \[|Link token \(hidden\)/); // the questions, not the summary
    const after = readEnv(envFile);
    assert.equal(after.SEMMAL_PLATFORM_URL, "http://172.20.10.9:3001");
    assert.equal(after.SEMMAL_GATEWAY_URL, "ws://172.20.10.9:3001/api/gateway");
    assert.equal(after.SEMMAL_BASE_LAT, SAVED.SEMMAL_BASE_LAT);
    assert.equal(after.SEMMAL_LINK_TOKEN, "");
  });
});

test("pressing Enter at the menu changes nothing", () => {
  withRobot((dir, envFile) => {
    const before = readFileSync(envFile, "utf8");
    const out = runSetup(dir, [], "\n");
    assert.match(out, /Nothing changed/);
    assert.equal(readFileSync(envFile, "utf8"), before);
  });
});
