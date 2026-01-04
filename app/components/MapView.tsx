"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";

// Dynamic imports prevent SSR “window is not defined” issues with Leaflet
const MapContainer = dynamic(
  () => import("react-leaflet").then((m) => m.MapContainer),
  { ssr: false }
);
const TileLayer = dynamic(
  () => import("react-leaflet").then((m) => m.TileLayer),
  { ssr: false }
);
const CircleMarker = dynamic(
  () => import("react-leaflet").then((m) => m.CircleMarker),
  { ssr: false }
);
const Popup = dynamic(() => import("react-leaflet").then((m) => m.Popup), {
  ssr: false,
});

type AirportStatus = {
  code: string;
  name: string;
  lat: number;
  lon: number;
  status: "normal" | "delay" | "ground_stop" | "closed" | "unknown";
  sourceError?: string;
  faaRaw?: any;
};

type ApiResponse = {
  updatedAt: string;
  airports: AirportStatus[];
};

function statusColor(s: AirportStatus["status"]) {
  switch (s) {
    case "normal":
      return "green";
    case "delay":
      return "orange";
    case "ground_stop":
      return "red";
    case "closed":
      return "black";
    default:
      return "gray";
  }
}

export default function MapView() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setError(null);
      const res = await fetch("/api/airports", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ApiResponse;
      setData(json);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000); // refresh every minute
    return () => clearInterval(id);
  }, []);

  const airports = data?.airports ?? [];

  const center = useMemo<[number, number]>(() => {
    // Center on continental US for MVP
    return [39.5, -98.35];
  }, []);

  return (
    <div style={{ height: "100vh", width: "100vw" }}>
      <MapContainer center={center} zoom={4} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {airports.map((a) => (
          <CircleMarker
            key={a.code}
            center={[a.lat, a.lon]}
            radius={10}
            pathOptions={{ color: statusColor(a.status) }}
          >
            <Popup>
              <div style={{ minWidth: 220 }}>
                <div style={{ fontWeight: 700 }}>
                  {a.code} — {a.name}
                </div>
                <div>Status: {a.status}</div>
                {a.sourceError ? <div>FAA fetch: {a.sourceError}</div> : null}
                {data?.updatedAt ? (
                  <div style={{ marginTop: 8, opacity: 0.7, fontSize: 12 }}>
                    Updated: {new Date(data.updatedAt).toLocaleString()}
                  </div>
                ) : null}
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>

      {/* Simple overlay */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 1000,
          background: "white",
          padding: 10,
          borderRadius: 8,
          boxShadow: "0 2px 12px rgba(0,0,0,0.12)",
          fontSize: 14,
        }}
      >
        <div style={{ fontWeight: 700 }}>Aviation Safety Watch (MVP)</div>
        <div>Airports plotted: {airports.length}</div>
        {error ? <div style={{ marginTop: 6 }}>API error: {error}</div> : null}
        <div style={{ marginTop: 6, opacity: 0.75 }}>
          Status source: FAA airport status endpoint (if available)
        </div>
      </div>
    </div>
  );
}
