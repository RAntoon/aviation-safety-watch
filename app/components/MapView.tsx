"use client";

import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";

type AirportPoint = {
  code: string;
  name: string;
  lat: number;
  lon: number;
  status: "normal" | "delay" | "ground_stop";
  note?: string;
};

function makeDotIcon(color: string) {
  return L.divIcon({
    className: "",
    html: `<div style="
      width: 12px; height: 12px;
      border-radius: 999px;
      background: ${color};
      border: 2px solid white;
      box-shadow: 0 1px 6px rgba(0,0,0,.35);
    "></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6]
  });
}

export default function MapView() {
  const [airports, setAirports] = useState<AirportPoint[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string>("");

  useEffect(() => {
    const run = async () => {
      const res = await fetch("/api/airports", { cache: "no-store" });
      const json = await res.json();
      setAirports(json.airports ?? []);
      setUpdatedAt(json.updatedAt ?? "");
    };
    run();
  }, []);

  const icons = useMemo(() => {
    return {
      normal: makeDotIcon("#2ecc71"),
      delay: makeDotIcon("#f1c40f"),
      ground_stop: makeDotIcon("#e74c3c")
    };
  }, []);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", height: "100vh" }}>
      <aside style={{ padding: 16, borderRight: "1px solid #e5e5e5", overflow: "auto" }}>
        <h1 style={{ margin: "0 0 8px 0" }}>Aviation Safety Watch</h1>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 16 }}>
          Updated: {updatedAt ? new Date(updatedAt).toLocaleString() : "—"}
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          {airports.map((a) => (
            <div key={a.code} style={{ padding: 12, border: "1px solid #eee", borderRadius: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background:
                      a.status === "normal" ? "#2ecc71" : a.status === "delay" ? "#f1c40f" : "#e74c3c"
                  }}
                />
                <strong>{a.code}</strong>
                <span style={{ color: "#666" }}>{a.name}</span>
              </div>
              <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
                {a.status.toUpperCase()}
                {a.note ? ` — ${a.note}` : ""}
              </div>
            </div>
          ))}
        </div>
      </aside>

      <main style={{ height: "100%", width: "100%" }}>
        <MapContainer center={[39.5, -98.35]} zoom={4} style={{ height: "100%", width: "100%" }}>
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {airports.map((a) => (
            <Marker key={a.code} position={[a.lat, a.lon]} icon={icons[a.status]}>
              <Popup>
                <div style={{ fontWeight: 700 }}>{a.code}</div>
                <div>{a.name}</div>
                <div style={{ marginTop: 6 }}>
                  Status: <b>{a.status}</b>
                </div>
                {a.note ? <div style={{ marginTop: 6 }}>{a.note}</div> : null}
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </main>
    </div>
  );
}
