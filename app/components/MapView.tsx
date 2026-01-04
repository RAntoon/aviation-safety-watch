"use client";

import React, { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";

type Airport = {
  code: string;
  name: string;
  lat: number;
  lon: number;
};

type ApiAirportStatus = {
  code: string;
  name?: string;
  status: "normal" | "delay" | "ground_stop" | "unknown";
  note?: string;
};

type ApiResponse = {
  updatedAt: string;
  source: string;
  airports: ApiAirportStatus[];
};

const AIRPORTS: Airport[] = [
  // Real coordinates:
  { code: "LAX", name: "Los Angeles Intl", lat: 33.9416, lon: -118.4085 },
  { code: "SFO", name: "San Francisco Intl", lat: 37.6213, lon: -122.3790 },
  { code: "JFK", name: "John F. Kennedy Intl", lat: 40.6413, lon: -73.7781 },
  { code: "ORD", name: "Chicago O'Hare Intl", lat: 41.9742, lon: -87.9073 },
];

function statusLabel(s: ApiAirportStatus["status"]) {
  switch (s) {
    case "ground_stop":
      return "GROUND STOP";
    case "delay":
      return "DELAY";
    case "normal":
      return "NORMAL";
    default:
      return "UNKNOWN";
  }
}

export default function MapView() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const codes = useMemo(() => AIRPORTS.map((a) => a.code).join(","), []);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        setError(null);
        const res = await fetch(`/api/airports?codes=${encodeURIComponent(codes)}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const json = (await res.json()) as ApiResponse;
        if (!cancelled) setData(json);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Fetch failed");
      }
    }

    run();
    const id = setInterval(run, 60_000); // refresh every 60s
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [codes]);

  const statusByCode = useMemo(() => {
    const m = new Map<string, ApiAirportStatus>();
    for (const a of data?.airports || []) m.set(a.code, a);
    return m;
  }, [data]);

  return (
    <div style={{ height: "100vh", width: "100vw" }}>
      <MapContainer center={[39.5, -98.35]} zoom={4} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {AIRPORTS.map((a) => {
          const s = statusByCode.get(a.code);
          // Don’t “invent” a status: if FAA fetch fails, it stays UNKNOWN.
          const status = s?.status ?? "unknown";

          // Leaflet default marker coloring is awkward without icon assets.
          // CircleMarker keeps it simple; color is just for visibility, not to imply certainty.
          const radius = status === "ground_stop" ? 10 : status === "delay" ? 9 : 8;

          return (
            <CircleMarker key={a.code} center={[a.lat, a.lon]} radius={radius} pathOptions={{}}>
              <Popup>
                <div style={{ minWidth: 220 }}>
                  <div style={{ fontWeight: 700 }}>
                    {a.code} — {a.name}
                  </div>
                  <div>
                    Status: <b>{statusLabel(status)}</b>
                  </div>
                  {s?.note ? <div style={{ marginTop: 6 }}>{s.note}</div> : null}
                  <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
                    Source: {data?.source || "—"}
                    <br />
                    Updated: {data?.updatedAt ? new Date(data.updatedAt).toLocaleString() : "—"}
                  </div>
                  {error ? (
                    <div style={{ marginTop: 8, fontSize: 12, color: "#b00020" }}>
                      API: {error}
                    </div>
                  ) : null}
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>

      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 1000,
          background: "white",
          padding: 12,
          borderRadius: 10,
          boxShadow: "0 2px 12px rgba(0,0,0,0.12)",
          maxWidth: 320,
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Aviation Safety Watch (MVP)</div>
        <div style={{ fontSize: 13, opacity: 0.85 }}>
          Airports plotted: {AIRPORTS.length}
          <br />
          FAA status: server-side ASWS fetch (real FAA source)
        </div>
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
          If an airport shows <b>UNKNOWN</b>, we are not guessing—FAA fetch didn’t return a usable status.
        </div>
      </div>
    </div>
  );
}
