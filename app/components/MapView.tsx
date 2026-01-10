"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";

// ✅ Cluster CSS
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";

import * as RL from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";

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

  // short/high-level text
  summary?: string;

  // optional extra display field
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

function shortText(s: string, max = 280) {
  const cleaned = String(s || "")
    .replace(/&#x0D;|\\r\\n|\\n|\\r/g, "\n")
    .trim();

  // take the first “paragraph-ish” chunk
  const firstBlock = cleaned.split("\n").map(t => t.trim()).filter(Boolean)[0] || "";
  if (!firstBlock) return "";

  return firstBlock.length > max ? firstBlock.slice(0, max - 1) + "…" : firstBlock;
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

      const nextPoints: MapPoint[] = Array.isArray(json?.points) ? json.points : [];
      setPoints(nextPoints);

      const dbg = `rows=${json?.totalRows ?? "?"}, coords=${json?.rowsWithCoords ?? "?"}, inRange=${json?.rowsInRange ?? "?"}`;
      setStatus(`OK. Loaded ${nextPoints.length} points. (${dbg})`);
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
        <ZoomControl position="bottomright" />

        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* ✅ Cluster + spiderfy overlapping dots */}
        <MarkerClusterGroup
          chunkedLoading
          showCoverageOnHover={false}
          zoomToBoundsOnClick={false}
          spiderfyOnMaxZoom={true}
          maxClusterRadius={40}
        >
          {points.map((p) => {
            const titleRight = p.aircraftType ? ` - ${p.aircraftType}` : "";

            // fallback “search docket” link (always usable)
            const searchUrl = p.ntsbCaseId
              ? `https://data.ntsb.gov/Docket/forms/Searchdocket?NTSBNumber=${encodeURIComponent(String(p.ntsbCaseId).trim())}`
              : "https://data.ntsb.gov/Docket/forms/Searchdocket";

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
                <Popup autoPan={false}>
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
                        {shortText(p.summary, 320)}
                      </div>
                    ) : null}

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {p.docketUrl ? (
                        <a href={p.docketUrl} target="_blank" rel="noreferrer" style={{ fontWeight: 800 }}>
                          Open docket →
                        </a>
                      ) : null}

                      <a href={searchUrl} target="_blank" rel="noreferrer" style={{ fontWeight: 800 }}>
                        Search docket →
                      </a>
                    </div>

                    <div style={{ fontSize: 11, opacity: 0.7, marginTop: 8 }}>
                      Note: some dockets are not released yet and will show a “not released” message.  [oai_citation:1‡NTSB Data](https://data.ntsb.gov/Docket/?NTSBNumber=CEN25FA289)
                    </div>
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}
        </MarkerClusterGroup>
      </MapContainer>
    </div>
  );
}
