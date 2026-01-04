"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

const MapContainer = dynamic(() => import("react-leaflet").then((m) => m.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import("react-leaflet").then((m) => m.TileLayer), { ssr: false });
const Marker = dynamic(() => import("react-leaflet").then((m) => m.Marker), { ssr: false });
const Popup = dynamic(() => import("react-leaflet").then((m) => m.Popup), { ssr: false });

type Airport = {
  code: string;
  name: string;
  lat: number;
  lon: number;
  status: "normal" | "delay" | "ground_stop" | "unknown";
  note?: string;
};

export default function MapView() {
  const [data, setData] = useState<{ updatedAt: string; airports: Airport[] } | null>(null);
  const [error, setError] = useState<string>("");

  // Fix Leaflet default marker icons when bundled (runs only in browser)
  useEffect(() => {
    (async () => {
      const L = await import("leaflet");
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });
    })();
  }, []);

  async function load() {
    try {
      setError("");
      const res = await fetch("/api/airports", { cache: "no-store" });
      if (!res.ok) throw new Error(`API error HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  const airports = data?.airports ?? [];

  // If FAA didn’t provide lat/lon, those markers will be at 0,0 (off Africa) — we’ll fix next if needed.
  const validAirports = useMemo(() => airports.filter((a) => Math.abs(a.lat) > 1 && Math.abs(a.lon) > 1), [airports]);

  return (
    <div style={{ height: "100vh", width: "100vw", position: "relative" }}>
      <div
        style={{
          position: "absolute",
          zIndex: 1000,
          top: 12,
          left: 12,
          background: "white",
          padding: 12,
          borderRadius: 10,
          boxShadow: "0 2px 12px rgba(0,0,0,0.12)",
          maxWidth: 360,
          fontSize: 14,
          lineHeight: 1.35,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Aviation Safety Watch (MVP)</div>
        <div style={{ opacity: 0.8, marginBottom: 8 }}>
          Data source: FAA Airport Status Web Service (ASWS) (via server API)
        </div>

        {error ? (
          <div style={{ color: "crimson" }}>API error: {error}</div>
        ) : (
          <>
            <div style={{ marginBottom: 8, opacity: 0.8 }}>Updated: {data?.updatedAt ?? "—"}</div>
            <div style={{ display: "grid", gap: 6 }}>
              {airports.map((a) => (
                <div key={a.code} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span>
                    <b>{a.code}</b> {a.name ? `— ${a.name}` : ""}
                  </span>
                  <span style={{ opacity: 0.9 }}>{a.status}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10, opacity: 0.7, fontSize: 12 }}>
              If statuses show “unknown / fetch failed”, the FAA endpoint is blocked or returning a non-JSON response.
            </div>
          </>
        )}
      </div>

      <MapContainer center={[39.5, -98.35]} zoom={4} scrollWheelZoom={true} style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {validAirports.map((a) => (
          <Marker key={a.code} position={[a.lat, a.lon]}>
            <Popup>
              <div style={{ fontWeight: 700 }}>{a.code} — {a.name}</div>
              <div>Status: {a.status}</div>
              {a.note ? <div style={{ marginTop: 6, opacity: 0.85 }}>{a.note}</div> : null}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
