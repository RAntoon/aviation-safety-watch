"use client";

import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";

type Airport = {
  code: string;
  name: string;
  lat: number;
  lon: number;
  status: "unknown" | "normal" | "delay" | "ground_stop" | "closed";
  source?: string;
  updatedAt?: string;
  note?: string;
  faa?: {
    Status: string | null;
    Delay: string | null;
    Reason: string | null;
    Trend: string | null;
    EndTime: string | null;
  };
};

type ApiResp = {
  updatedAt: string;
  airports: Airport[];
};

function statusLabel(s: Airport["status"]) {
  switch (s) {
    case "normal":
      return "NORMAL";
    case "delay":
      return "DELAY";
    case "ground_stop":
      return "GROUND STOP";
    case "closed":
      return "CLOSED";
    default:
      return "UNKNOWN";
  }
}

export default function MapView() {
  const [data, setData] = useState<ApiResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setError(null);
      const r = await fetch("/api/airports", { cache: "no-store" });
      if (!r.ok) throw new Error(`API HTTP ${r.status}`);
      const j = (await r.json()) as ApiResp;
      setData(j);
    } catch (e: any) {
      setError(e?.message || "Fetch failed");
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000); // refresh every 60s
    return () => clearInterval(t);
  }, []);

  const airports = data?.airports ?? [];

  const center = useMemo(() => [39.5, -98.35] as [number, number], []);

  return (
    <div style={{ height: "100vh", width: "100vw" }}>
      <div
        style={{
          position: "absolute",
          zIndex: 1000,
          padding: 12
        }}
      >
        <div
          style={{
            background: "white",
            padding: 10,
            borderRadius: 8,
            boxShadow: "0 2px 12px rgba(0,0,0,0.12)",
            maxWidth: 420
          }}
        >
          <div style={{ fontWeight: 700 }}>Aviation Safety Watch (MVP)</div>
          <div>Airports plotted: {airports.length}</div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            Data source: FAA ASWS (official FAA endpoint)
          </div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            Updated: {data?.updatedAt ? new Date(data.updatedAt).toLocaleString() : "—"}
          </div>
          {error ? (
            <div style={{ marginTop: 6, fontSize: 12, color: "crimson" }}>
              Map API error: {error}
            </div>
          ) : null}
        </div>
      </div>

      <MapContainer center={center} zoom={4} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {airports.map((a) => (
          <CircleMarker
            key={a.code}
            center={[a.lat, a.lon]}
            radius={8}
            pathOptions={{
              // keep it simple for MVP (color defaults are fine, but you can color by status later)
            }}
          >
            <Popup>
              <div style={{ minWidth: 220 }}>
                <div style={{ fontWeight: 700 }}>
                  {a.code} — {a.name}
                </div>
                <div>Status: {statusLabel(a.status)}</div>
                <div style={{ fontSize: 12, opacity: 0.85 }}>
                  Source: {a.source || "—"}
                </div>

                {a.faa ? (
                  <div style={{ fontSize: 12, marginTop: 6 }}>
                    <div>FAA Status: {a.faa.Status ?? "—"}</div>
                    <div>FAA Delay: {a.faa.Delay ?? "—"}</div>
                    <div>Reason: {a.faa.Reason ?? "—"}</div>
                    <div>Trend: {a.faa.Trend ?? "—"}</div>
                    <div>EndTime: {a.faa.EndTime ?? "—"}</div>
                  </div>
                ) : null}

                {a.note ? (
                  <div style={{ fontSize: 12, marginTop: 6, color: "crimson" }}>
                    Note: {a.note}
                  </div>
                ) : null}
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
