"use client";

import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";

type Airport = {
  code: string;
  name: string;
  lat: number;
  lon: number;
  status: "normal" | "delay" | "ground_stop" | "unknown";
  source?: string;
  updatedAt?: string;
  note?: string | null;
  raw?: {
    Delay: boolean | null;
    GroundStop: boolean | null;
    Reason: string | null;
  };
};

type ApiResponse = {
  updatedAt: string;
  airports: Airport[];
};

function colorFor(status: Airport["status"]) {
  // No “guessing” — just display categories.
  if (status === "ground_stop") return "#d32f2f";
  if (status === "delay") return "#f57c00";
  if (status === "normal") return "#2e7d32";
  return "#455a64"; // unknown
}

export default function MapView() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch("/api/airports", { cache: "no-store" });
      if (!res.ok) throw new Error(`API HTTP ${res.status}`);
      const json = (await res.json()) as ApiResponse;
      setData(json);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load");
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000); // refresh every 60s
    return () => clearInterval(t);
  }, []);

  const airports = data?.airports ?? [];

  const headerText = useMemo(() => {
    if (error) return `API error: ${error}`;
    if (!data) return "Loading FAA status…";
    return "FAA status: server-side ASWS fetch (real FAA source). If UNKNOWN, we are not guessing.";
  }, [data, error]);

  return (
    <div style={{ height: "100vh", width: "100vw" }}>
      <div
        style={{
          position: "absolute",
          zIndex: 1000,
          left: 12,
          top: 12,
          background: "white",
          padding: 10,
          borderRadius: 10,
          boxShadow: "0 2px 12px rgba(0,0,0,0.12)",
          maxWidth: 360,
          fontSize: 14,
        }}
      >
        <div style={{ fontWeight: 700 }}>Aviation Safety Watch (MVP)</div>
        <div>Airports plotted: {airports.length}</div>
        <div style={{ marginTop: 6 }}>{headerText}</div>
        {data?.updatedAt ? (
          <div style={{ marginTop: 6, opacity: 0.8 }}>Updated: {new Date(data.updatedAt).toLocaleString()}</div>
        ) : null}
      </div>

      <MapContainer
        center={[39.5, -98.35]} // Continental US
        zoom={4}
        scrollWheelZoom={true}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {airports.map((a) => (
          <CircleMarker
            key={a.code}
            center={[a.lat, a.lon]}
            radius={10}
            pathOptions={{
              color: colorFor(a.status),
              fillColor: colorFor(a.status),
              fillOpacity: 0.8,
            }}
          >
            <Popup>
              <div style={{ fontWeight: 700 }}>
                {a.code} — {a.name}
              </div>
              <div>
                Status: <b>{a.status.toUpperCase()}</b>
              </div>
              <div>Source: {a.source ?? "—"}</div>
              <div>Updated: {a.updatedAt ? new Date(a.updatedAt).toLocaleString() : "—"}</div>
              <div style={{ marginTop: 6 }}>
                Note: {a.note ? a.note : "—"}
              </div>
              {a.raw ? (
                <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>
                  FAA raw: Delay={String(a.raw.Delay)} GroundStop={String(a.raw.GroundStop)} Reason={String(a.raw.Reason)}
                </div>
              ) : null}
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
