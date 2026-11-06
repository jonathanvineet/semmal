"use client";
/**
 * Map for bookings and tracking. OpenStreetMap standard tiles (tile.openstreetmap.org, attribution
 * shown, light interactive use only, per the OSM tile usage policy). Robots appear as ~1 km circles
 * (their public base is coarse); the customer's site and the robot's live position as points.
 */
import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { Circle, CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";

export type Pt = { lat: number; lon: number };
export type MapRobot = Pt & { id: string; label: string; active?: boolean; dim?: boolean; radiusKm?: number };

function Picker({ onPick }: { onPick?: (p: Pt) => void }) {
  useMapEvents({ click: (e) => onPick?.({ lat: e.latlng.lat, lon: e.latlng.lng }) });
  return null;
}

function Fit({ points, fitKey }: { points: Pt[]; fitKey: string }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) map.setView([points[0]!.lat, points[0]!.lon], Math.max(map.getZoom(), 13));
    else map.fitBounds(points.map((p) => [p.lat, p.lon]) as LatLngBoundsExpression, { padding: [28, 28], maxZoom: 15 });
  }, [fitKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export default function LeafletMap({
  center, robots = [], site, route, live, onPick, onRobot, className, fit = [],
}: {
  center: Pt; robots?: MapRobot[]; site?: Pt | null; route?: [number, number][] | null; live?: (Pt & { label?: string }) | null;
  onPick?: (p: Pt) => void; onRobot?: (id: string) => void; className?: string; fit?: Pt[];
}) {
  return (
    <MapContainer center={[center.lat, center.lon]} zoom={12} scrollWheelZoom className={`smap ${className ?? ""}`} attributionControl>
      <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' />
      <Picker onPick={onPick} />
      <Fit points={fit} fitKey={fit.map((p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`).join("|")} />
      {robots.map((r) => (
        <Circle
          key={r.id}
          center={[r.lat, r.lon]}
          radius={1000}
          pathOptions={{ color: r.active ? "#ff7a4a" : r.dim ? "#6b6f78" : "#8fd8ff", weight: r.active ? 3 : 1.5, fillOpacity: r.active ? 0.25 : 0.12 }}
          eventHandlers={{ click: () => onRobot?.(r.id) }}
        >
          <Tooltip direction="top" opacity={0.95}>{r.label}</Tooltip>
        </Circle>
      ))}
      {route && route.length > 1 && <Polyline positions={route} pathOptions={{ color: "#ff7a4a", weight: 4, opacity: 0.85 }} />}
      {site && (
        <CircleMarker center={[site.lat, site.lon]} radius={8} pathOptions={{ color: "#fff", weight: 2, fillColor: "#3ddc97", fillOpacity: 1 }}>
          <Tooltip direction="top" permanent={false}>Your site</Tooltip>
        </CircleMarker>
      )}
      {live && (
        <CircleMarker center={[live.lat, live.lon]} radius={9} pathOptions={{ color: "#fff", weight: 2, fillColor: "#ff7a4a", fillOpacity: 1 }} className="smap__live">
          <Tooltip direction="top" permanent>{live.label ?? "Robot"}</Tooltip>
        </CircleMarker>
      )}
    </MapContainer>
  );
}
