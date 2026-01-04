"use client";

import dynamic from "next/dynamic";
import "leaflet/dist/leaflet.css";
import React, { useEffect, useState } from "react";

/* 🔒 Dynamically import react-leaflet components */
const MapContainer = dynamic(
  () => import("react-leaflet").then((m) => m.MapContainer as any),
  { ssr: false }
);
const TileLayer = dynamic(
  () => import("react-leaflet").then((m) => m.TileLayer as any),
  { ssr: false }
);
const CircleMarker = dynamic(
  () => import("react-leaflet").then((m) => m.CircleMarker as any),
  { ssr: false }
);
const Popup = dynamic(
  () => import("react-leaflet").then((m) => m.Popup as any),
  { ssr: false }
);

type Marker = {
  id: string;
  lat: number;
  lon: number;
  title: string;
  date?: string;
  ntsb?: string;
};

export default function MapView() {
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");

    try {
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - 30);

      const s = start.toISOString().slice(0, 10);
      const e = end.toISOString().slice(0, 10);

      const r = await fetch(`/api/ntsb?start=${s}&end=${e}`, {
        cache: "no-store",
      });

      const data = await r.json();
      const cases = data?.cases || data?.Cases || data || [];

      const rows: Marker[] = [];

      for (const c of cases) {
        const lat = Number(c.latitude ?? c.Latitude);
        const lon = Number(c.longitude ?? c.Longitude);

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

        rows.push({
          id: String(c.mkey ?? c.NtsbNumber ?? `${lat}-${lon}`),
          lat,
          lon,
          title: c.EventType ?? "Aviation Accident",
          date: c.EventDate,
          ntsb: c.NtsbNumber,
        });
      }

      setMarkers(rows);
    } catch (e: any) {
      setError(String(e.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div style={{ height: "100vh", width: "100vw" }}>
      {/* Control panel */}
      <div
        style={{
          position: "absolute",
          zIndex: 1000,
          top: 12,
          left: 12,
          background: "white",
          padding: 12,
          borderRadius: 8,
          boxShadow: "0 2px 10px rgba(0,0,0,0.15)",
          fontSize: 14,
        }}
      >
        <strong>NTSB Aviation Accidents</strong>
        <div style={{ marginTop: 6 }}>
          {loading ? "Loading…" : `${markers.length} plotted`}
        </div>
        {error && <div style={{ color: "crimson" }}>{error}</div>}
      </div>

      <MapContainer
        center={[39.5, -98.35]}
        zoom={4}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
        />

        {markers.map((m) => (
          <CircleMarker
            key={m.id}
            center={[m.lat, m.lon]}
            radius={7}
            pathOptions={{}}
          >
            <Popup>
              <strong>{m.title}</strong>
              {m.date && <div>Date: {m.date}</div>}
              {m.ntsb && <div>NTSB #: {m.ntsb}</div>}
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
