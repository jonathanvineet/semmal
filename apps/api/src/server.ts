import { buildApp, defaultDeps } from "./app";

const deps = defaultDeps();
const app = buildApp(deps);
app.log.info({ config: deps.config.report }, "SEMMAL API config (presence only, no values)");
// API_HOST=0.0.0.0 lets robot PCs on your network reach the gateway and the runner; default stays local
await app.listen({ port: deps.config.API_PORT, host: process.env.API_HOST || "127.0.0.1" });
app.log.info(`listening on ${process.env.API_HOST || "127.0.0.1"}:${deps.config.API_PORT}`);
const code = deps.admin.bootstrapCode();
if (code) {
  // Printed only to this terminal. Whoever can read it can claim ownership once.
  console.log(`\n  No owner yet. Open ${deps.config.WEB_ORIGIN}/admin, connect your wallet, sign in,\n  and enter this one-time setup code:  ${code}\n`);
}
