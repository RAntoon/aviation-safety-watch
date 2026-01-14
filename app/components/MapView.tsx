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

  docketUrl?: string;
  ntsbCaseId?: string;

  summary?: string;
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
  if (kind === "fatal") return "#d32f2f"; // red
  if (kind === "accident") return "#fb8c00"; // orange
  return "#fdd835"; // yellow
}

function shortNarrative(input?: string, maxChars = 300) {
  if (!input) return "";
  const cleaned = String(input)
    .replace(/&#x0D;|\\r\\n|\\n|\\r/g, "\n")
    .trim();

  // Take first non-empty paragraph-ish line
  const first = cleaned
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)[0];

  if (!first) return "";

  return first.length > maxChars ? first.slice(0, maxChars - 1) + "…" : first;
}

/**
 * Spread points that share identical coordinates into a small ring.
 * No extra libs required. Makes overlapping dots clickable.
 *
 * radiusDeg: ~0.03 degrees ≈ 2 miles at equator (smaller at higher lat).
 * We use a smaller default: 0.015 (~1 mile). Adjust if you want tighter.
 */
function spreadOverlaps(points: MapPoint[], radiusDeg = 0.015): MapPoint[] {
  const groups = new Map<string, MapPoint[]>();

  for (const p of points) {
    // Key by rounded coords so tiny float diffs still group
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

    // Spread around a circle centered at original point
    const n = arr.length;
    for (let i = 0; i < n; i++) {
      const p = arr[i];
      const angle = (2 * Math.PI * i) / n;

      // Slightly increase radius with count so huge stacks spread more
      const r = radiusDeg * (1 + Math.min(2, n / 25));

      const lat2 = p.lat + r * Math.sin(angle);
      const lng2 = p.lng + r * Math.cos(angle);

      out.push({
        ...p,
        // keep id stable but unique in case duplicates exist
        id: `${p.id}__s${i}`,
        lat: lat2,
        lng: lng2,
      });
    }
  }

  return out;
}

export default function MapView() {
  const defaultRange = useMemo(() => last12MonthsRange(), []);
  const [start, setStart] = useState<string>(isoDate(defaultRange.start));
  const [end, setEnd] = useState<string>(isoDate(defaultRange.end));

  const [points, setPoints] = useState<MapPoint[]>([]);
  const [status, setStatus] = useState<string>("Idle");
  const [loading, setLoading] = useState<boolean>(false);

  const center: LatLngExpression = useMemo(() => [39.5, -98.35], []); // US-centered default

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
        setStatus(`Accidents fetch not OK (${res.status}). ${String(upstream || "").slice(0, 140)}`);
        console.error("API /api/accidents error:", { status: res.status, upstream });
        return;
      }

      const rawPoints: MapPoint[] = Array.isArray(json?.points) ? json.points : [];

      // ✅ Spread overlaps (same airport / same coords)
      const spread = spreadOverlaps(rawPoints);

      setPoints(spread);

      const dbg = `rows=${json?.totalRows ?? "?"}, coords=${json?.rowsWithCoords ?? "?"}, inRange=${json?.rowsInRange ?? "?"}`;
      setStatus(`OK. Loaded ${spread.length} points. (${dbg})`);
    } catch (e: any) {
      setPoints([]);
      setStatus(`Fetch failed (network/runtime). See console.`);
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
          Data source: NTSB exports · Default range: last 12 months
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Start</div>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              style={{ 
                width: "100%", 
                padding: 8, 
                borderRadius: 8, 
                border: "1px solid #ddd",
                boxSizing: "border-box"
              }}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>End</div>
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              style={{ 
                width: "100%", 
                padding: 8, 
                borderRadius: 8, 
                border: "1px solid #ddd",
                boxSizing: "border-box"
              }}
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

      {/* Copyright Footer - Bottom Left */}
      <div
        style={{
          position: "absolute",
          zIndex: 1000,
          bottom: 12,
          left: 12,
          padding: "6px 0",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
          fontSize: 12,
          color: "#333",
        }}
      >
        Copyright © {new Date().getFullYear()}{" "}
        <a 
          href="https://antooncorp.com" 
          target="_blank" 
          rel="noopener noreferrer"
          style={{ 
            color: "#333",
            textDecoration: "none"
          }}
        >
          Antoon Corporation
        </a>
        {" "}– All Rights Reserved.
      </div>

      {/* Map */}
      <MapContainer
        center={center}
        zoom={4}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
        zoomControl={false}
      >
        <ZoomControl position="bottomright" />

        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {points.map((p) => {
          const titleRight = p.aircraftType ? ` - ${p.aircraftType}` : "";

          // Primary docket link (sometimes dockets aren't published yet)
          const docketUrl =
            p.ntsbCaseId
              ? `https://data.ntsb.gov/Docket/?NTSBNumber=${encodeURIComponent(String(p.ntsbCaseId).trim())}`
              : undefined;

          // Fallback: search page (always works as a fallback)
          const searchUrl =
            p.ntsbCaseId
              ? `https://data.ntsb.gov/Docket/forms/Searchdocket?NTSBNumber=${encodeURIComponent(String(p.ntsbCaseId).trim())}`
              : `https://data.ntsb.gov/Docket/forms/Searchdocket`;

          return (
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
              {/* ✅ prevents map shifting/zooming when popup opens */}
              <Popup autoPan={false} closeOnClick={false}>
                <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" }}>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>
                    {p.kind === "fatal"
                      ? `Fatal Accident${titleRight}`
                      : p.kind === "accident"
                      ? `Accident${titleRight}`
                      : `Incident${titleRight}`}
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
                    <div style={{ fontSize: 12, opacity: 0.9, marginBottom: 8 }}>
                      {shortNarrative(p.summary, 320)}
                    </div>
                  ) : null}

                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    {docketUrl ? (
                      <a href={docketUrl} target="_blank" rel="noreferrer" style={{ fontWeight: 800 }}>
                        Open docket →
                      </a>
                    ) : null}

                    <a href={searchUrl} target="_blank" rel="noreferrer" style={{ fontWeight: 800 }}>
                      Search docket →
                    </a>
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}