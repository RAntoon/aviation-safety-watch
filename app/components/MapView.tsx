"use client";

import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";

type AirportStatus = "normal" | "delay" | "ground_stop";

type Airport = {
  code: string;
  name: string;
  lat: number;
  lon: number;
  status: AirportStatus;
  note?: string;
};

type AirportsResponse = {
  updatedAt: string;
  airports: Airport[];
};

function statusStyle(status: AirportStatus) {
  switch (status) {
    case "ground_stop":
      return { radius: 10, color: "#b91c1c", fillColor: "#ef4444" };
    case "delay":
      return { radius: 8, color: "#92400e", fillColor: "#f59e0b" };
    default:
      return { radius: 6, color: "#065f46", fillColor: "#10b981" };
  }
}

export default function MapView() {
  const [data, setData] = useState<AirportsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setErr(null);
        const res = await fetch("/api/airports", { cache: "no-store" });
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const json = (await res.json()) as AirportsResponse;
        if (!cancelled) setData(json);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? "Failed to load airports");
      }
    }

    load();
    const t = setInterval(load, 60_000); // refresh every 60s
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const airports = data?.airports ?? [];
  const updatedAt = data?.updatedAt ?? null;

  const counts = useMemo(() => {
    const c = { normal: 0, delay: 0, ground_stop: 0 };
    for (const a of airports) c[a.status] += 1;
    return c;
  }, [airports]);

  return (
    <div style={{ height: "100vh", width: "100vw", position: "relative" }}>
      {/* Overlay header */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 1000,
          background: "white",
          padding: 12,
          borderRadius: 10,
          boxShadow: "0 6px 20px rgba(0,0,0,0.12)",
          maxWidth: 360,
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 18 }}>Aviation Safety Watch</div>
        <div style={{ fontSize: 13, opacity: 0.8, marginTop: 4 }}>
          Airports: {airports.length} • Normal: {counts.normal} • Delay:{" "}
          {counts.delay} • Ground stop: {counts.ground_stop}
        </div>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
          {updatedAt ? `Updated: ${updatedAt}` : "Loading…"}
        </div>
        {err ? (
          <div style={{ marginTop: 8, color: "#b91c1c", fontSize: 13 }}>
            {err}
          </div>
        ) : null}
      </div>

      <MapContainer
        center={[39.5, -98.35]} // continental US
        zoom={4}
        scrollWheelZoom={true}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {airports.map((a) => {
          const s = statusStyle(a.status);
          return (
            <CircleMarker
              key={a.code}
              center={[a.lat, a.lon]}
              radius={s.radius}
              pathOptions={{ color: s.color, fillColor: s.fillColor, fillOpacity: 0.85 }}
            >
              <Popup>
                <div style={{ fontWeight: 700 }}>
                  {a.code} — {a.name}
                </div>
                <div>Status: {a.status}</div>
                {a.note ? <div>Note: {a.note}</div> : null}
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}
