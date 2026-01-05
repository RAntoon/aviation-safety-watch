"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
  ZoomControl,
} from "react-leaflet";

type Category = "fatal_accident" | "accident" | "incident";

type Point = {
  lat: number;
  lon: number;
  category: Category;
  fatalities: number;
  eventType: string | null;
  ntsbNumber: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  date: string | null;
  docketUrl: string | null;
};

function ymd(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function defaultLast12Months() {
  const end = new Date();
  const start = new Date(end);
  start.setFullYear(end.getFullYear() - 1);
  return { start: ymd(start), end: ymd(end) };
}

function colorFor(category: Category) {
  // match your request
  if (category === "fatal_accident") return "#d32f2f"; // red
  if (category === "accident") return "#f57c00"; // orange
  return "#fbc02d"; // yellow
}

export default function MapView() {
  const defaults = useMemo(() => defaultLast12Months(), []);
  const [start, setStart] = useState(defaults.start);
  const [end, setEnd] = useState(defaults.end);

  const [status, setStatus] = useState<string>("Idle");
  const [points, setPoints] = useState<Point[]>([]);

  async function load() {
    setStatus("Loading…");
    setPoints([]);

    try {
      const res = await fetch(`/api/ntsb?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, {
        cache: "no-store",
      });

      const json = await res.json();

      if (!res.ok || !json?.ok) {
        setStatus(
          `NTSB fetch failed (${res.status}). Check /api/ntsb response in Vercel logs.`
        );
        return;
      }

      setPoints(json.points || []);
      setStatus(`OK — ${json.count ?? (json.points || []).length} points`);
    } catch (e: any) {
      setStatus(`Fetch error: ${String(e?.message || e)}`);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => {
    const c = { fatal: 0, accident: 0, incident: 0 };
    for (const p of points) {
      if (p.category === "fatal_accident") c.fatal++;
      else if (p.category === "accident") c.accident++;
      else c.incident++;
    }
    return c;
  }, [points]);

  return (
    <div style={{ height: "100vh", width: "100vw", position: "relative" }}>
      {/* Control panel (top-left) */}
      <div
        style={{
          position: "absolute",
          zIndex: 1000,
          top: 12,
          left: 12,
          width: 360,
          background: "white",
          borderRadius: 12,
          padding: 14,
          boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>
          Aviation Safety Watch (MVP)
        </div>
        <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 10 }}>
          Data source: NTSB Public API · Default range: last 12 months
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Start</div>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>End</div>
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
            />
          </div>
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center" }}>
          <button
            onClick={load}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: "#f5f5f5",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            Reload
          </button>
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            Dots shown: <b>{points.length}</b>
          </div>
        </div>

        <div style={{ marginTop: 12, fontWeight: 800 }}>Legend</div>
        <div style={{ display: "grid", gap: 6, marginTop: 8, fontSize: 13 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ width: 14, height: 14, borderRadius: 999, background: "#d32f2f" }} />
            Fatal accidents (red): <b>{counts.fatal}</b>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ width: 14, height: 14, borderRadius: 999, background: "#f57c00" }} />
            Accidents (orange): <b>{counts.accident}</b>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ width: 14, height: 14, borderRadius: 999, background: "#fbc02d" }} />
            Incidents (yellow): <b>{counts.incident}</b>
          </div>
        </div>

        <div style={{ marginTop: 10, fontSize: 12 }}>
          <b>Status:</b> {status}
        </div>
      </div>

      {/* Map */}
      <MapContainer
        center={[39.5, -98.35]} // continental US
        zoom={4}
        scrollWheelZoom
        zoomControl={false} // we will place it ourselves
        style={{ height: "100%", width: "100%" }}
      >
        {/* Put zoom buttons away from the panel */}
        <ZoomControl position="topright" />

        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {points.map((p, idx) => (
          <CircleMarker
            key={`${p.lat},${p.lon},${idx}`}
            center={[p.lat, p.lon]}
            radius={6}
            pathOptions={{
              color: colorFor(p.category),
              fillColor: colorFor(p.category),
              fillOpacity: 0.85,
              weight: 2,
            }}
          >
            <Popup>
              <div style={{ minWidth: 220 }}>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>
                  {p.category === "fatal_accident"
                    ? "Fatal accident"
                    : p.category === "accident"
                    ? "Accident"
                    : "Incident"}
                </div>

                <div style={{ fontSize: 13, lineHeight: 1.35 }}>
                  {p.date && (
                    <div>
                      <b>Date:</b> {p.date}
                    </div>
                  )}
                  {(p.city || p.state || p.country) && (
                    <div>
                      <b>Location:</b>{" "}
                      {[p.city, p.state, p.country].filter(Boolean).join(", ")}
                    </div>
                  )}
                  {p.ntsbNumber && (
                    <div>
                      <b>NTSB #:</b> {p.ntsbNumber}
                    </div>
                  )}
                  {p.eventType && (
                    <div>
                      <b>Type:</b> {p.eventType}
                    </div>
                  )}
                  <div>
                    <b>Fatalities:</b> {p.fatalities ?? 0}
                  </div>

                  {p.docketUrl ? (
                    <div style={{ marginTop: 8 }}>
                      <a href={p.docketUrl} target="_blank" rel="noreferrer">
                        Open NTSB Docket
                      </a>
                    </div>
                  ) : (
                    <div style={{ marginTop: 8, opacity: 0.7 }}>
                      Docket link not available for this record.
                    </div>
                  )}
                </div>
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
