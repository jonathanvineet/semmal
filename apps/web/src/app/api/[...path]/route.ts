/**
 * Forwards /api/* to the SEMMAL API (it holds the robots' live WebSocket links, sessions and
 * databases, so it runs on a long-lived host, not as a Vercel function). API_INTERNAL_URL points at it:
 * http://127.0.0.1:3001 in development, or a public HTTPS tunnel/host in production.
 * Adds the headers that skip ngrok's and VS Code dev tunnels' browser warning pages, and tells the API the
 * original host and scheme.
 */
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // agent jobs wait for a 0G answer (~10-30 s)

const API = (process.env.API_INTERNAL_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");
const DROP_REQUEST = new Set(["host", "connection", "content-length", "accept-encoding", "x-forwarded-host", "x-forwarded-proto"]);
const DROP_RESPONSE = new Set(["content-encoding", "content-length", "transfer-encoding", "connection"]);

async function forward(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const url = `${API}/api/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
  const headers = new Headers();
  req.headers.forEach((v, k) => !DROP_REQUEST.has(k.toLowerCase()) && headers.set(k, v));
  // tunnels show a warning page to browser-like requests unless told to skip it (ngrok, VS Code dev tunnels)
  headers.set("ngrok-skip-browser-warning", "1");
  headers.set("X-Tunnel-Skip-AntiPhishing-Page", "true");
  headers.set("x-forwarded-host", req.headers.get("host") ?? req.nextUrl.host);
  headers.set("x-forwarded-proto", req.nextUrl.protocol.replace(":", ""));
  const hasBody = !["GET", "HEAD"].includes(req.method);
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      redirect: "manual",
      cache: "no-store",
    });
  } catch {
    return Response.json({ error: "The SEMMAL API is not reachable (check that it and its tunnel are running)." }, { status: 502 });
  }
  const out = new Headers();
  upstream.headers.forEach((v, k) => !DROP_RESPONSE.has(k.toLowerCase()) && k.toLowerCase() !== "set-cookie" && out.set(k, v));
  for (const c of upstream.headers.getSetCookie?.() ?? []) out.append("set-cookie", c);
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export { forward as GET, forward as POST, forward as PUT, forward as PATCH, forward as DELETE };
