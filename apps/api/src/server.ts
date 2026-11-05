import { buildApp, defaultDeps } from "./app";

const deps = defaultDeps();
const app = buildApp(deps);
app.log.info({ config: deps.config.report }, "SEMMAL API config (presence only, no values)");
await app.listen({ port: deps.config.API_PORT, host: "127.0.0.1" });
