"use client";

import React, { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";

// Leaflet CSS (make sure this exists somewhere globally too; safe here for MVP)
import "leaflet/dist/leaflet.css";

// Dynamically import react-leaflet components (client-only)
const MapContainer = dynamic(() => import("react-leaflet").then((m) => m.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import("react-leaflet").then((m) => m.TileLayer), { ssr: false });
const Marker = dynamic(() => import("react-leaflet").then((m) => m.Marker), { ssr: false });
const Popup = dynamic(() => import("react-leaflet").then((m) => m.Popup), { ssr: false });
const ZoomControl = dynamic(() => import("react-leaflet").then((m) => m.ZoomControl), { ssr: false });

// Leaflet icon fix for Next builds
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// @ts-ignore
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

type MarkerKind = "fatal" | "accident" | "incident";

type Point = {
  id: string;
  title: string;
  date?: string;
  kind: MarkerKind;
  lat: number;
  lon: number;
  docketUrl?: string;
  raw?: any;
};

function ymd(d: Date) {
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

export default function MapView() {
  const defaultRange = useMemo(() => {
    const r = last12MonthsRange();
    return { start: ymd(r.start), end: ymd(r.end) };
  }, []);

  const [start, setStart] = useState(defaultRange.start);
  const [end, setEnd] = useState(defaultRange.end);

  const [status, setStatus] = useState<string>("Idle");
  const [points, setPoints] = useState<Point[]>([]);
  const [counts, setCounts] = useState({ fatal: 0, accident: 0, incident: 0 });

  // Map center / zoom
  const usCenter: [number, number] = [39.5, -98.35];
  const zoom = 4;

  async function load() {
    setStatus("Loading…");
    setPoints([]);
    setCounts({ fatal: 0, accident: 0, incident: 0 });

    try {
      const res = await fetch(`/api/ntsb?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, {
        cache: "no-store",
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setStatus(`NTSB fetch not OK. Open /api/ntsb to see upstreamError.`);
        return;
      }

      const pts: Point[] = Array.isArray(json.points) ? json.points : [];
      setPoints(pts);

      const c = { fatal: 0, accident: 0, incident: 0 };
      for (const p of pts) c[p.kind] += 1;
      setCounts(c);

      setStatus(`OK (${pts.length} items)`);
    } catch (e: any) {
      setStatus(`Error: ${String(e?.message || e)}`);
    }
  }

  useEffect(() => {
    // Auto-load on first render
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const legendDot = (color: string) => (
    <span
      style={{
        display: "inline-block",
        width: 14,
        height: 14,
        borderRadius: 999,
        background: color,
        border: "2px solid rgba(0,0,0,0.25)",
        marginRight: 8,
        verticalAlign: "middle",
      }}
    />
  );

  function colorFor(kind: MarkerKind) {
    if (kind === "fatal") return "#d93025"; // red
    if (kind === "accident") return "#f29900"; // orange
    return "#fbbc04"; // yellow
  }

  return (
    <div style={{ position: "relative", height: "100vh", width: "100vw" }}>
      {/* Control Panel */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 999,
          background: "rgba(255,255,255,0.95)",
          padding: 14,
          borderRadius: 12,
          width: 340,
          boxShadow: "0 6px 24px rgba(0,0,0,0.18)",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Aviation Safety Watch (MVP)</div>
        <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 10 }}>
          Data source: NTSB endpoint • Default range: last 12 months
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Start</div>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>End</div>
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
          <button
            onClick={load}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: "#f6f6f6",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Reload
          </button>
          <div style={{ fontSize: 13 }}>Dots shown: <b>{points.length}</b></div>
        </div>

        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Legend</div>
        <div style={{ fontSize: 13, marginBottom: 6 }}>
          {legendDot("#d93025")} Fatal accidents (red): <b>{counts.fatal}</b>
        </div>
        <div style={{ fontSize: 13, marginBottom: 6 }}>
          {legendDot("#f29900")} Accidents (orange): <b>{counts.accident}</b>
        </div>
        <div style={{ fontSize: 13, marginBottom: 10 }}>
          {legendDot("#fbbc04")} Incidents (yellow): <b>{counts.incident}</b>
        </div>

        <div style={{ fontSize: 13, color: status.includes("OK") ? "#137333" : "#b3261e" }}>
          <b>Status:</b> {status}
        </div>
      </div>

      {/* Map */}
      <MapContainer
        center={usCenter}
        zoom={zoom}
        scrollWheelZoom
        zoomControl={false}   // ✅ disable default so we can place it manually
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* ✅ Zoom control bottom-right */}
        <ZoomControl position="bottomright" />

        {points.map((p) => (
          <Marker key={p.id} position={[p.lat, p.lon] as any}>
            <Popup>
              <div style={{ minWidth: 220 }}>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>{p.title}</div>
                {p.date && <div style={{ marginBottom: 6 }}><b>Date:</b> {p.date}</div>}
                <div style={{ marginBottom: 6 }}>
                  <b>Category:</b>{" "}
                  <span style={{ color: colorFor(p.kind), fontWeight: 800 }}>
                    {p.kind === "fatal" ? "Fatal accident" : p.kind === "accident" ? "Accident" : "Incident"}
                  </span>
                </div>
                {p.docketUrl ? (
                  <a href={p.docketUrl} target="_blank" rel="noreferrer">
                    Open NTSB docket
                  </a>
                ) : (
                  <div style={{ opacity: 0.7 }}>No docket link available</div>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
