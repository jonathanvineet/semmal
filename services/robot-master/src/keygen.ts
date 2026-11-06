/** Create this robot's device key (once). Prints only the public address. */
import { homedir } from "node:os";
import { join } from "node:path";
import { generateDeviceKey } from "./device";

const path = process.env.SEMMAL_ROBOT_KEY_FILE || join(homedir(), ".semmal", "robot-key");
const address = generateDeviceKey(path);
console.log(`Robot device key created at ${path} (owner-only file). Never copy it anywhere.`);
console.log(`Robot wallet address: ${address}`);
console.log("Next: fund it with test tGLM (https://hub.arkiv.network/faucet) and 0G (https://faucet.0g.ai),");
console.log("then register the robot at /robots/new with this address as its robot wallet.");
