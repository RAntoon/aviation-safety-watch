"use client";

import React from "react";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";

type AirportStatus = "normal" | "delay" | "ground_stop" | "unknown";

type Airport = {
  code: string;
  name: string;
  lat: number;
  lon: number;
  status: AirportStatus;
  note?: string;
};

type ApiResponse = {
  updatedAt: string;
  airports: Airport[];
};

function statusToRadius(status: AirportStatus) {
  switch (status) {
    case "delay":
      return 10;
    case "ground_stop":
      return 12;
    case "normal":
      return 7;
    default:
      return 6;
  }
}

function statusToColor(status: AirportStatus) {
  switch (status) {
    case "delay":
      return "#f59e0b"; // amber
    case "ground_stop":
      return "#ef4444"; // red
    case "normal":
      return "#22c55e"; // green
    default:
      return "#64748b"; // slate
  }
}

export default function MapView() {
  const [data, setData] = React.useState<ApiResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setError(null);
        const res = await fetch("/api/airports", { cache: "no-store" });
        if (!res.ok) throw new Error(`API error ${res.status}`);
        const json = (await res.json()) as ApiResponse;
        if (!cancelled) setData(json);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load");
      }
    }

    load();
    const t = setInterval(load, 60_000); // refresh every 60s (real data, but not too spammy)
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return (
    <div style={{ height: "100vh", width: "100vw" }}>
      <div style={{ position: "absolute", zIndex: 1000, padding: 12 }}>
        <div style={{ background: "white", padding: 10, borderRadius: 8, boxShadow: "0 2px 12px rgba(0,0,0,0.12)" }}>
          <div style={{ fontWeight: 700 }}>Aviation Safety Watch</div>
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            {error ? `Error: ${error}` : data ? `Updated: ${new Date(data.updatedAt).toLocaleString()}` : "Loading..."}
          </div>
        </div>
      </div>

      <MapContainer center={[39.5, -98.35]} zoom={4} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {(data?.airports ?? []).map((a) => (
          <CircleMarker
            key={a.code}
            center={[a.lat, a.lon]}
            radius={statusToRadius(a.status)}
            pathOptions={{ color: statusToColor(a.status), fillColor: statusToColor(a.status), fillOpacity: 0.7 }}
          >
            <Popup>
              <div style={{ fontWeight: 700 }}>{a.code} — {a.name}</div>
              <div>Status: {a.status}</div>
              {a.note ? <div style={{ marginTop: 6 }}>{a.note}</div> : null}
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
