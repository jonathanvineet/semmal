/**
 * Driving routes for robot deliveries, from the public OSRM demo server (project-osrm.org, API v5:
 * /route/v1/driving/{lon},{lat};{lon},{lat}?overview=full&geometries=geojson; distance in metres,
 * duration in seconds). The demo server allows at most 1 request per second, non-commercial, no
 * uptime guarantee, so routes are cached and throttled here. If it cannot be reached the route is a
 * straight line at 30 km/h, and says so (source "straight-line").
 */
import { distanceM, type LatLon } from "@semmal/contracts";

export type Route = { source: "osrm" | "straight-line"; distanceM: number; durationS: number; coords: [number, number][] };

const OSRM = (process.env.OSRM_URL || "https://router.project-osrm.org").replace(/\/$/, "");
const cache = new Map<string, { at: number; route: Route }>();
let last = 0;
const key = (a: LatLon, b: LatLon) => [a.lat, a.lon, b.lat, b.lon].map((v) => v.toFixed(4)).join(",");

export function straightLine(a: LatLon, b: LatLon): Route {
  const d = distanceM(a, b);
  const n = Math.max(2, Math.min(50, Math.ceil(d / 200)));
  const coords: [number, number][] = Array.from({ length: n + 1 }, (_, i) => [a.lat + ((b.lat - a.lat) * i) / n, a.lon + ((b.lon - a.lon) * i) / n]);
  return { source: "straight-line", distanceM: Math.round(d), durationS: Math.round(d / 8.33), coords };
}

export async function routeBetween(a: LatLon, b: LatLon, fetcher: typeof fetch = fetch): Promise<Route> {
  const k = key(a, b);
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.route;
  const wait = last + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  let route: Route;
  try {
    const url = `${OSRM}/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson`;
    const r = await fetcher(url, { signal: AbortSignal.timeout(8000), headers: { "user-agent": "SEMMAL robot marketplace prototype (dev)" } });
    const d = (await r.json()) as { code?: string; routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[] };
    const best = d.code === "Ok" ? d.routes?.[0] : undefined;
    if (!best) throw new Error(d.code ?? "no route");
    const step = Math.max(1, Math.ceil(best.geometry.coordinates.length / 400));
    const coords = best.geometry.coordinates.filter((_, i, all) => i % step === 0 || i === all.length - 1).map(([lon, lat]) => [lat, lon] as [number, number]);
    route = { source: "osrm", distanceM: Math.round(best.distance), durationS: Math.round(best.duration), coords };
  } catch {
    route = straightLine(a, b);
  }
  cache.set(k, { at: Date.now(), route });
  return route;
}
