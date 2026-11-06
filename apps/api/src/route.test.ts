import { test } from "node:test";
import assert from "node:assert/strict";
import { routeBetween, straightLine } from "./route";

const A = { lat: 13.0827, lon: 80.2707 };
const B = { lat: 13.0569, lon: 80.2425 };

test("an OSRM route is read as lat,lon points with metres and seconds", async () => {
  let asked = "";
  const fake = (async (url: string) => {
    asked = url;
    return new Response(JSON.stringify({ code: "Ok", routes: [{ distance: 5234.5, duration: 812.2, geometry: { coordinates: [[80.2707, 13.0827], [80.26, 13.07], [80.2425, 13.0569]] } }] }));
  }) as unknown as typeof fetch;
  const r = await routeBetween(A, B, fake);
  assert.match(asked, /\/route\/v1\/driving\/80\.2707,13\.0827;80\.2425,13\.0569\?overview=full&geometries=geojson$/);
  assert.equal(r.source, "osrm");
  assert.equal(r.distanceM, 5235);
  assert.equal(r.durationS, 812);
  assert.deepEqual(r.coords[0], [13.0827, 80.2707]);
});

test("when OSRM is unreachable the route is a labelled straight line", async () => {
  const down = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
  const r = await routeBetween({ lat: 12.9, lon: 80.1 }, { lat: 12.95, lon: 80.15 }, down);
  assert.equal(r.source, "straight-line");
  assert.ok(r.distanceM > 7000 && r.distanceM < 8000);
  const s = straightLine(A, B);
  assert.deepEqual(s.coords[0], [A.lat, A.lon]);
  assert.deepEqual(s.coords.at(-1), [B.lat, B.lon]);
});
