// @ts-nocheck
"use client";

import { useEffect, useState, useMemo } from "react";
import dynamic from "next/dynamic";
import "leaflet/dist/leaflet.css";

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
const ZoomControl = dynamic(
  () => import("react-leaflet").then((m) => m.ZoomControl),
  { ssr: false }
);

function toInputDate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function last12MonthsRange() {
  const end = new Date();
  const start = new Date(end);
  start.setFullYear(end.getFullYear() - 1);
  return { start: toInputDate(start), end: toInputDate(end) };
}

export default function MapView() {
  const center = useMemo(() => [39.5, -98.35], []);

  const defaults = last12MonthsRange();
  const [start, setStart] = useState(defaults.start);
  const [end, setEnd] = useState(defaults.end);

  const [dots, setDots] = useState([]);
  const [status, setStatus] = useState("Idle");

  async function load() {
    setStatus("Loading…");
    setDots([]);
    try {
      const res = await fetch(
        `/api/ntsb?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
        { cache: "no-store" }
      );
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setStatus(`NTSB fetch failed (${res.status})`);
        return;
      }
      const rows = Array.isArray(json.data) ? json.data : [];
      const mapped = rows
        .map((r) => {
          const lat = Number(r?.Latitude ?? r?.latitude ?? r?.Lat ?? r?.lat);
          const lon = Number(
            r?.Longitude ?? r?.longitude ?? r?.Lon ?? r?.lon
          );
          if (!lat || !lon) return null;
          return {
            id: `${lat}-${lon}-${r?.NtsbNumber || ""}`,
            lat,
            lon,
            title:
              r?.AirportName ||
              r?.airportName ||
              r?.Location ||
              r?.location ||
              r?.City ||
              r?.city ||
              r?.NtsbNumber ||
              "",
          };
        })
        .filter(Boolean);
      setDots(mapped);
      setStatus("OK");
    } catch (e) {
      setStatus(`Fetch error: ${String(e)}`);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div style={{ height: "100vh", width: "100%", position: "relative" }}>
      <MapContainer
        center={center}
        zoom={4}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
        zoomControl={false}
      >
        <ZoomControl position="topright" />

        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        {dots.map((d) => (
          <CircleMarker
            key={d.id}
            center={[d.lat, d.lon]}
            radius={6}
            pathOptions={{}}
          >
            <Popup>
              <div style={{ minWidth: 180 }}>
                <strong>{d.title}</strong>
                <div>
                  {d.lat.toFixed(3)}, {d.lon.toFixed(3)}
                </div>
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>

      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 1000,
          background: "white",
          padding: 10,
          borderRadius: 8,
          width: 300,
          fontSize: 13,
        }}
      >
        <div style={{ marginBottom: 6 }}>
          <strong>Status:</strong> {status}
        </div>
        <div style={{ marginBottom: 8 }}>
          <label>
            Start
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              style={{ width: "100%", marginTop: 4 }}
            />
          </label>
        </div>
        <div style={{ marginBottom: 8 }}>
          <label>
            End
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              style={{ width: "100%", marginTop: 4 }}
            />
          </label>
        </div>
        <button onClick={load} style={{ width: "100%", padding: 8 }}>
          Reload
        </button>
      </div>
    </div>
  );
}
