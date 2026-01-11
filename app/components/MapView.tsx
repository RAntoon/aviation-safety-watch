"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import * as RL from "react-leaflet";
import ClockWidget from "./ClockWidget";

// ✅ Hard-stop the annoying TS mismatch in some Vercel builds.
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

  date?: string;
  city?: string;
  state?: string;
  country?: string;

  ntsbCaseId?: string;
  docketUrl?: string;
  reportUrl?: string;

  summary?: string;

  tailNumber?: string;
  aircraftType?: string;
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
  if (kind === "fatal") return "#d32f2f";
  if (kind === "accident") return "#fb8c00";
  return "#fdd835";
}

function shortNarrative(input?: string, maxChars = 300) {
  if (!input) return "";
  const cleaned = String(input)
    .replace(/&#x0D;|\\r\\n|\\n|\\r/g, "\n")
    .trim();

  const first = cleaned
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)[0];

  if (!first) return "";
  return first.length > maxChars ? first.slice(0, maxChars - 1) + "…" : first;
}

/**
 * Spread points that share identical coordinates into a small ring.
 */
function spreadOverlaps(points: MapPoint[], radiusDeg = 0.015): MapPoint[] {
  const groups = new Map<string, MapPoint[]>();

  for (const p of points) {
    const key = `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
    const arr = groups.get(key) ?? [];
    arr.push(p);
    groups.set(key, arr);
  }

  const out: MapPoint[] = [];

  for (const arr of groups.values()) {
    if (arr.length === 1) {
      out.push(arr[0]);
      continue;
    }

    const n = arr.length;
    for (let i = 0; i < n; i++) {
      const p = arr[i];
      const angle = (2 * Math.PI * i) / n;
      const r = radiusDeg * (1 + Math.min(2, n / 25));

      out.push({
        ...p,
        id: `${p.id}__s${i}`,
        lat: p.lat + r * Math.sin(angle),
        lng: p.lng + r * Math.cos(angle),
      });
    }
  }

  return out;
}

function eventLabel(kind: PointKind) {
  if (kind === "fatal") return "Fatal Accident";
  if (kind === "accident") return "Accident";
  return "Incident";
}

function buildTitleLine(p: MapPoint) {
  const tail = p.tailNumber?.trim() ?? "";
  const type = p.aircraftType?.trim() ?? "";
  const right = [tail, type].filter(Boolean).join(" ");
  return right ? `${eventLabel(p.kind)} - ${right}` : eventLabel(p.kind);
}

export default function MapView() {
  const defaultRange = useMemo(() => last12MonthsRange(), []);
  const [start, setStart] = useState<string>(isoDate(defaultRange.start));
  const [end, setEnd] = useState<string>(isoDate(defaultRange.end));
  const [q, setQ] = useState<string>("");

  const [points, setPoints] = useState<MapPoint[]>([]);
  const [status, setStatus] = useState("Idle");
  const [loading, setLoading] = useState(false);

  const center: LatLngExpression = useMemo(() => [39.5, -98.35], []);

  async function load() {
    setLoading(true);
    try {
      const url =
        `/api/accidents?start=${encodeURIComponent(start)}` +
        `&end=${encodeURIComponent(end)}` +
        (q ? `&q=${encodeURIComponent(q)}` : "");

      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();
      const raw = Array.isArray(json?.points) ? json.points : [];
      setPoints(spreadOverlaps(raw));
      setStatus(`Loaded ${raw.length} events`);
    } catch {
      setPoints([]);
      setStatus("Load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="asw-root">
      <ClockWidget />

      {/* CONTROL PANEL (UNCHANGED) */}
      <div className="asw-panel">
        <div style={{ fontWeight: 800, fontSize: 18 }}>Aviation Safety Watch</div>

        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search tail, aircraft, city, narrative…"
          onKeyDown={(e) => e.key === "Enter" && load()}
          style={{ width: "100%", marginTop: 8, padding: 8 }}
        />

        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>

        <button onClick={load} disabled={loading} style={{ marginTop: 8 }}>
          {loading ? "Loading…" : "Reload"}
        </button>

        <div style={{ fontSize: 12, marginTop: 6 }}>Status: {status}</div>
      </div>

      {/* MAP */}
      <MapContainer center={center} zoom={4} className="asw-map" zoomControl={false}>
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
              fillColor: colorFor(p.kind),
              fillOpacity: 0.9,
            }}
          >
            <Popup autoPan={false}>
              <div>
                <div style={{ fontWeight: 800 }}>{buildTitleLine(p)}</div>

                {p.date && <div>Date: {p.date}</div>}
                {p.city && <div>Location: {[p.city, p.state].filter(Boolean).join(", ")}</div>}

                {p.summary && <div style={{ fontSize: 12 }}>{shortNarrative(p.summary)}</div>}

                <div style={{ marginTop: 6 }}>
                  {p.reportUrl && (
                    <a href={p.reportUrl} target="_blank" rel="noreferrer">
                      Open report →
                    </a>
                  )}
                  {p.ntsbCaseId && (
                    <div>
                      <a
                        href={`https://data.ntsb.gov/Docket/?NTSBNumber=${encodeURIComponent(
                          p.ntsbCaseId
                        )}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open docket →
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>

      {/* ✅ ONLY NEW ADDITION */}
      <a
        href="https://antooncorp.com"
        target="_blank"
        rel="noreferrer"
        style={{
          position: "absolute",
          bottom: 10,
          left: 12,
          zIndex: 1000,
          fontSize: 12,
          color: "#555",
          textDecoration: "none",
          background: "rgba(255,255,255,0.85)",
          padding: "6px 10px",
          borderRadius: 8,
          boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
        }}
      >
        © 2025 Antoon Corporation — All Rights Reserved.
      </a>

      <style jsx global>{`
        .asw-root {
          height: 100dvh;
          width: 100vw;
          position: relative;
        }
        .asw-map {
          height: 100%;
          width: 100%;
        }
        .asw-panel {
          position: absolute;
          top: 12px;
          left: 12px;
          z-index: 1000;
          background: white;
          padding: 12px;
          border-radius: 8px;
          width: 300px;
        }
      `}</style>
    </div>
  );
}
