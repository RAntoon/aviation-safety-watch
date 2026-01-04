"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import "leaflet/dist/leaflet.css";

import type React from "react";
import type {
  MapContainerProps,
  TileLayerProps,
  CircleMarkerProps,
  PopupProps,
} from "react-leaflet";

type NtsbPoint = {
  id: string;
  name: string;
  date: string;
  lat: number;
  lon: number;
  url?: string;
};

function isoDateOnly(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ✅ Properly typed dynamic imports (this fixes the “center/zoom does not exist” TS errors)
const MapContainer = dynamic(
  () => import("react-leaflet").then((m) => m.MapContainer),
  { ssr: false }
) as unknown as React.ComponentType<MapContainerProps>;

const TileLayer = dynamic(
  () => import("react-leaflet").then((m) => m.TileLayer),
  { ssr: false }
) as unknown as React.ComponentType<TileLayerProps>;

const CircleMarker = dynamic(
  () => import("react-leaflet").then((m) => m.CircleMarker),
  { ssr: false }
) as unknown as React.ComponentType<CircleMarkerProps>;

const Popup = dynamic(
  () => import("react-leaflet").then((m) => m.Popup),
  { ssr: false }
) as unknown as React.ComponentType<PopupProps>;

export default function MapView() {
  const today = useMemo(() => new Date(), []);
  const defaultStart = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d;
  }, []);

  const [start, setStart] = useState<string>(isoDateOnly(defaultStart));
  const [end, setEnd] = useState<string>(isoDateOnly(today));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [points, setPoints] = useState<NtsbPoint[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string>("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/ntsb?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
        { cache: "no-store" }
      );

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(
          `NTSB fetch failed (${res.status}). ${txt || "Check /api/ntsb server logs."}`
        );
      }

      const data = (await res.json()) as { updatedAt: string; points: NtsbPoint[] };
      setPoints(Array.isArray(data.points) ? data.points : []);
      setUpdatedAt(data.updatedAt || new Date().toLocaleString());
    } catch (e: any) {
      setPoints([]);
      setError(e?.message || "NTSB fetch failed.");
      setUpdatedAt(new Date().toLocaleString());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const center: [number, number] = [39.5, -98.35];

  return (
    <div style={{ height: "100vh", width: "100vw" }}>
      {/* Controls */}
      <div style={{ position: "absolute", zIndex: 1000, left: 12, top: 12, width: 360 }}>
        <div
          style={{
            background: "white",
            padding: 12,
            borderRadius: 10,
            boxShadow: "0 2px 12px rgba(0,0,0,0.12)",
            fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Aviation Safety Watch (MVP)</div>
          <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 10 }}>
            Data source: NTSB Public API • Default range: last 12 months
          </div>

          <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, marginBottom: 4 }}>Start</div>
              <input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                style={{ width: "100%", padding: 6 }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, marginBottom: 4 }}>End</div>
              <input
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                style={{ width: "100%", padding: 6 }}
              />
            </div>
          </div>

          <button
            onClick={load}
            disabled={loading}
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid #ddd",
              background: loading ? "#f6f6f6" : "white",
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Loading..." : "Reload"}
          </button>

          <div style={{ marginTop: 10, fontSize: 12 }}>Dots shown: {points.length}</div>
          {error ? <div style={{ marginTop: 6, color: "#b00020", fontSize: 12 }}>{error}</div> : null}
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>Updated: {updatedAt || "—"}</div>
        </div>
      </div>

      {/* Map */}
      <MapContainer center={center} zoom={4} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {points.map((p) => (
          <CircleMarker key={p.id} center={[p.lat, p.lon]} radius={6} pathOptions={{ weight: 1, fillOpacity: 0.7 }}>
            <Popup>
              <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial" }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{p.name || "NTSB Case"}</div>
                <div style={{ fontSize: 12, marginBottom: 6 }}>{p.date}</div>
                {p.url ? (
                  <a href={p.url} target="_blank" rel="noreferrer">
                    Open case
                  </a>
                ) : (
                  <div style={{ fontSize: 12, opacity: 0.8 }}>No case link available</div>
                )}
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
