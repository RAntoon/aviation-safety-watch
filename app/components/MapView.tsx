"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import * as RL from "react-leaflet";
import ClockWidget from "./ClockWidget";

// ✅ Hard-stop the annoying TS mismatch in some Vercel builds.
// Runtime behavior is correct; this only sidesteps broken typings.
const MapContainer = RL.MapContainer as unknown as React.FC<any>;
const TileLayer = RL.TileLayer as unknown as React.FC<any>;
const CircleMarker = RL.CircleMarker as unknown as React.FC<any>;
const Popup = RL.Popup as unknown as React.FC<any>;
const ZoomControl = RL.ZoomControl as unknown as React.FC<any>;

type PointKind = "fatal" | "accident" | "incident";

type MapPoint = {
  id: string;
  lat: number;
  lng: number;
  kind: PointKind;

  // display fields (safe optional)
  date?: string;
  city?: string;
  state?: string;
  country?: string;

  // NTSB / docket link
  docketUrl?: string;
  ntsbCaseId?: string;
  summary?: string;
};

function isoDate(d: Date) {
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

function colorFor(kind: PointKind) {
  if (kind === "fatal") return "#d32f2f"; // red
  if (kind === "accident") return "#fb8c00"; // orange
  return "#fdd835"; // yellow
}

export default function MapView() {
  const defaultRange = useMemo(() => last12MonthsRange(), []);
  const [start, setStart] = useState<string>(isoDate(defaultRange.start));
  const [end, setEnd] = useState<string>(isoDate(defaultRange.end));

  const [points, setPoints] = useState<MapPoint[]>([]);
  const [status, setStatus] = useState<string>("Idle");
  const [loading, setLoading] = useState<boolean>(false);

  const center: LatLngExpression = useMemo(() => [39.5, -98.35], []); // continental US

  const counts = useMemo(() => {
    let fatal = 0,
      accident = 0,
      incident = 0;
    for (const p of points) {
      if (p.kind === "fatal") fatal++;
      else if (p.kind === "accident") accident++;
      else incident++;
    }
    return { fatal, accident, incident, total: points.length };
  }, [points]);

  async function load() {
    setLoading(true);
    setStatus("Loading…");
    try {
      // ✅ Use the API route that returns { ok, points, totalRows, rowsWithCoords, rowsInRange }
      const url = `/api/accidents?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
      const res = await fetch(url, { cache: "no-store" });

      const text = await res.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        // leave null
      }

      if (!res.ok) {
        const upstream = json?.error || json?.message || text?.slice(0, 300);
        setPoints([]);
        setStatus(`NTSB fetch not OK (${res.status}). Open /api/ntsb to see upstreamError.`);
        console.error("API /api/ntsb error:", { status: res.status, upstream });
        return;
      }

      // Expecting: { ok:true, points:[...] }
      const nextPoints: MapPoint[] = Array.isArray(json?.points) ? json.points : [];
      setPoints(nextPoints);

      // ✅ Keep the debug status (don’t overwrite it)
      const dbg = `rows=${json?.totalRows ?? "?"}, coords=${json?.rowsWithCoords ?? "?"}, inRange=${json?.rowsInRange ?? "?"}`;
      setStatus(`OK. Loaded ${nextPoints.length} points. (${dbg})`);
    } catch (e: any) {
      setPoints([]);
      setStatus("Fetch failed (network/runtime). See console.");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ height: "100vh", width: "100vw", position: "relative" }}>
      {/* ✅ Clock in the upper-right */}
      <ClockWidget />

      {/* Control panel */}
      <div
        style={{
          position: "absolute",
          zIndex: 1000,
          top: 12,
          left: 12,
          width: 320,
          padding: 14,
          borderRadius: 12,
          background: "rgba(255,255,255,0.95)",
          boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 6 }}>
          Aviation Safety Watch
        </div>
        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 10 }}>
          Data source: NTSB endpoint · Default range: last 12 months
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

        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={load}
            disabled={loading}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: loading ? "#f4f4f4" : "#fff",
              cursor: loading ? "not-allowed" : "pointer",
              fontWeight: 700,
            }}
          >
            {loading ? "Loading…" : "Reload"}
          </button>

          <div style={{ fontSize: 12, opacity: 0.85 }}>
            Events: <b>{counts.total}</b>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Legend</div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: 7,
                background: colorFor("fatal"),
                display: "inline-block",
              }}
            />
            <div style={{ fontSize: 13 }}>
              Fatal accidents (red): <b>{counts.fatal}</b>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: 7,
                background: colorFor("accident"),
                display: "inline-block",
              }}
            />
            <div style={{ fontSize: 13 }}>
              Accidents (orange): <b>{counts.accident}</b>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: 7,
                background: colorFor("incident"),
                display: "inline-block",
              }}
            />
            <div style={{ fontSize: 13 }}>
              Incidents (yellow): <b>{counts.incident}</b>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.3 }}>
          <b>Status:</b>{" "}
          <span style={{ color: status.includes("not OK") || status.includes("failed") ? "#d32f2f" : "#222" }}>
            {status}
          </span>
        </div>
      </div>

      {/* Map */}
      <MapContainer
        center={center}
        zoom={4}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
        zoomControl={false}
      >
        {/* ✅ Zoom buttons in bottom-right */}
        <ZoomControl position="bottomright" />

        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {points.map((p) => (
          <CircleMarker
            key={p.id}
            center={[p.lat, p.lng]}
            radius={7}
            pathOptions={{
              color: "#333",
              weight: 1,
              fillColor: colorFor(p.kind),
              fillOpacity: 0.9,
            }}
          >
            <Popup>
              <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" }}>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>
                  {p.kind === "fatal" ? "Fatal Accident" : p.kind === "accident" ? "Accident" : "Incident"}
                </div>

                <div style={{ fontSize: 13, marginBottom: 6 }}>
                  {p.date ? (
                    <div>
                      <b>Date:</b> {p.date}
                    </div>
                  ) : null}
                  {p.city || p.state || p.country ? (
                    <div>
                      <b>Location:</b> {[p.city, p.state, p.country].filter(Boolean).join(", ")}
                    </div>
                  ) : null}
                  {p.ntsbCaseId ? (
                    <div>
                      <b>NTSB Case:</b> {p.ntsbCaseId}
                    </div>
                  ) : null}
                </div>

                {p.summary ? (
                  <div style={{ fontSize: 12, opacity: 0.9, marginBottom: 8 }}>{p.summary}</div>
                ) : null}

                {p.docketUrl ? (
                  <a href={p.docketUrl} target="_blank" rel="noreferrer" style={{ fontWeight: 800 }}>
                    Open NTSB docket →
                  </a>
                ) : (
                  <div style={{ fontSize: 12, opacity: 0.75 }}>(No docket link provided by API yet)</div>
                )}
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
