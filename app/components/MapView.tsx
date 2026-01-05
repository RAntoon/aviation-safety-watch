"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
  ZoomControl,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";

type Bucket = "fatal" | "accident" | "incident";

type NtsbPoint = {
  id: string;
  lat: number;
  lon: number;
  ntsbNumber?: string;
  mkey?: string;
  eventDate?: string;
  city?: string;
  state?: string;
  aircraft?: string;
  bucket: Bucket;
  fatal?: number;
  detailsUrl?: string | null;
};

function toYMD(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function last12MonthsRange() {
  const end = new Date();
  const start = new Date(end);
  start.setFullYear(end.getFullYear() - 1);
  return { start, end };
}

function markerStyle(bucket: Bucket) {
  // red = fatal accidents, orange = non-fatal accidents, yellow = incidents
  if (bucket === "fatal")
    return { color: "#b91c1c", fillColor: "#ef4444" }; // red-ish
  if (bucket === "accident")
    return { color: "#c2410c", fillColor: "#fb923c" }; // orange-ish
  return { color: "#a16207", fillColor: "#facc15" }; // yellow-ish
}

export default function MapView() {
  const defaultRange = useMemo(() => last12MonthsRange(), []);
  const [start, setStart] = useState<string>(toYMD(defaultRange.start));
  const [end, setEnd] = useState<string>(toYMD(defaultRange.end));

  const [status, setStatus] = useState<string>("Idle");
  const [points, setPoints] = useState<NtsbPoint[]>([]);
  const [sourceLine, setSourceLine] = useState<string>(
    "Data source: NTSB Public API · Default range: last 12 months"
  );

  async function load() {
    setStatus("Loading...");
    try {
      const res = await fetch(`/api/ntsb?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      const json = await res.json();

      if (!res.ok || !json?.ok) {
        const msg = json?.message || "NTSB fetch failed";
        setStatus(`${msg} (${res.status}). Check /api/ntsb response in Vercel logs.`);
        setPoints([]);
        return;
      }

      setSourceLine(
        `Data source: ${json.source || "NTSB Public API"} · Default range: last 12 months`
      );
      setPoints(Array.isArray(json.data) ? json.data : []);
      setStatus("OK");
    } catch (e: any) {
      setStatus(`Error: ${String(e)}`);
      setPoints([]);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => {
    const c = { fatal: 0, accident: 0, incident: 0 };
    for (const p of points) c[p.bucket]++;
    return c;
  }, [points]);

  const usCenter: [number, number] = [39.5, -98.35];

  return (
    <div style={{ height: "100vh", width: "100vw" }}>
      <MapContainer
        center={usCenter}
        zoom={4}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
        zoomControl={false} // <— we’ll put zoom somewhere else
      >
        {/* Zoom buttons moved away from your panel */}
        <ZoomControl position="topright" />

        <TileLayer
          // NOTE: react-leaflet v4 types can be finicky; keep it simple
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
        />

        {points.map((p) => {
          const style = markerStyle(p.bucket);
          return (
            <CircleMarker
              key={p.id}
              center={[p.lat, p.lon]}
              radius={6}
              pathOptions={{
                color: style.color,
                weight: 2,
                fillColor: style.fillColor,
                fillOpacity: 0.85,
              }}
            >
              <Popup>
                <div style={{ minWidth: 220 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>
                    {p.bucket === "fatal"
                      ? "Accident (Fatal)"
                      : p.bucket === "accident"
                      ? "Accident"
                      : "Incident"}
                  </div>

                  {p.eventDate && (
                    <div>
                      <b>Date:</b> {p.eventDate}
                    </div>
                  )}

                  {(p.city || p.state) && (
                    <div>
                      <b>Location:</b> {[p.city, p.state].filter(Boolean).join(", ")}
                    </div>
                  )}

                  {p.aircraft && (
                    <div>
                      <b>Aircraft:</b> {p.aircraft}
                    </div>
                  )}

                  {typeof p.fatal === "number" && (
                    <div>
                      <b>Fatalities:</b> {p.fatal}
                    </div>
                  )}

                  {(p.ntsbNumber || p.mkey) && (
                    <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>
                      <div>NTSB: {p.ntsbNumber || "—"}</div>
                      <div>MKey: {p.mkey || "—"}</div>
                    </div>
                  )}

                  {p.detailsUrl && (
                    <div style={{ marginTop: 8 }}>
                      <a href={p.detailsUrl} target="_blank" rel="noreferrer">
                        Open NTSB case page
                      </a>
                    </div>
                  )}
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>

      {/* Your panel */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 9999,
          background: "white",
          padding: 12,
          borderRadius: 10,
          boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
          width: 320,
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 18 }}>
          Aviation Safety Watch (MVP)
        </div>

        <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
          {sourceLine}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, marginBottom: 4 }}>Start</div>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              style={{ width: "100%" }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, marginBottom: 4 }}>End</div>
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              style={{ width: "100%" }}
            />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
          <button onClick={load} style={{ padding: "6px 10px" }}>
            Reload
          </button>
          <div style={{ fontSize: 13 }}>
            Dots shown: <b>{points.length}</b>
          </div>
        </div>

        {/* Legend */}
        <div style={{ marginTop: 10, fontSize: 13 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Legend</div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 999,
                background: "#ef4444",
                border: "2px solid #b91c1c",
                display: "inline-block",
              }}
            />
            <span>Fatal accidents (red): <b>{counts.fatal}</b></span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 999,
                background: "#fb923c",
                border: "2px solid #c2410c",
                display: "inline-block",
              }}
            />
            <span>Accidents (orange): <b>{counts.accident}</b></span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 999,
                background: "#facc15",
                border: "2px solid #a16207",
                display: "inline-block",
              }}
            />
            <span>Incidents (yellow): <b>{counts.incident}</b></span>
          </div>
        </div>

        <div style={{ marginTop: 10, fontSize: 12 }}>
          <b>Status:</b> {status}
        </div>
      </div>
    </div>
  );
}
