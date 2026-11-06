# Deploying the web app to Vercel

```
Browser ─https─▶ semmal.vercel.app (Next.js) ─/api/*─▶ ngrok HTTPS tunnel ─▶ SEMMAL API on the Mac (:3001)
Ubuntu robot PC ─────────────── LAN (robot link, agent jobs) ─────────────▶ SEMMAL API on the Mac
```

The API stays on a long-running host because it holds the robots' WebSocket links, sign-in sessions, live trips
and local databases, which Vercel functions cannot keep. The web app forwards `/api/*` to it through
`apps/web/src/app/api/[...path]/route.ts`, using `API_INTERNAL_URL`.

- **Vercel project:** `semmal` (root directory `apps/web`, Next.js, Node 22). Production: https://semmal.vercel.app
- **Vercel env:** `API_INTERNAL_URL` = the tunnel's HTTPS URL (production). Changing it needs a new deploy.
- **Mac `.env`:** `WEB_EXTRA_ORIGINS=https://semmal.vercel.app` (wallet sign-in accepts that site), `API_HOST=0.0.0.0`.
- **Tunnel:** `ngrok http --url=<your-static-domain>.ngrok-free.app 3001`. Use your free static domain from
  dashboard.ngrok.com → Domains, so the URL never changes. `ngrok http 3001` also works, but its URL changes each run.
- **Or VS Code port forwarding (dev tunnels):** Ports panel → Forward a Port → `3001` → sign in with GitHub →
  right-click the port → Port Visibility → **Public** → copy the Forwarded Address (`https://<id>-3001.<region>.devtunnels.ms`)
  into `API_INTERNAL_URL`. The address stays the same while VS Code keeps forwarding that port; the proxy sends
  `X-Tunnel-Skip-AntiPhishing-Page` so the tunnel's warning page is skipped.
- **Redeploy the web app:** `vercel deploy --prod` from the repo root (`.vercelignore` keeps `.env`, `data/`, ROS and
  Python files out of the upload).
- **Robots** keep linking to the Mac over the LAN (`pnpm setup <name>`, platform address `http://<mac-lan-ip>:3001`).
