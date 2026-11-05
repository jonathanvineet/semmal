import { z } from "zod";

/** Startup config validation. Prints which settings are present, never their values. */
const Env = z.object({
  API_PORT: z.coerce.number().int().default(3001),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  APP_MODE: z.enum(["simulation", "hardware"]).default("simulation"),
  ADMIN_STORE_PATH: z.string().default("../../data/admin.json"),
  SHOW_SIMULATED_FIXTURES: z.enum(["true", "false"]).default("true"),
  ZEROG_ROUTER_BASE_URL: z.string().url().optional().or(z.literal("")),
  ZEROG_REQUIRED_TRUST_MODE: z.enum(["private", "verified", "standard"]).default("private"),
});

export function loadConfig(env = process.env) {
  const parsed = Env.parse(env);
  const present = (k: string) => (env[k] ? "set" : "missing");
  const report = {
    APP_MODE: parsed.APP_MODE,
    ARKIV_ACCESS_KEY: present("ARKIV_ACCESS_KEY"),
    ADMIN: "wallet sign-in; roles in data/admin.json",
    ARKIV_SIGNING: "wallet only",
    ZEROG_ROUTER_BASE_URL: present("ZEROG_ROUTER_BASE_URL"),
    ZEROG_ROUTER_API_KEY: present("ZEROG_ROUTER_API_KEY"),
    ZEROG_DEFAULT_MODEL: env.ZEROG_DEFAULT_MODEL || "missing",
    ZEROG_VISION_MODEL: env.ZEROG_VISION_MODEL || "missing",
    ZEROG_REQUIRED_TRUST_MODE: parsed.ZEROG_REQUIRED_TRUST_MODE,
  };
  return { ...parsed, report };
}
