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

type PointKind = "fatal" | "accident" | "incident" | "occurrence";

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
  eventId?: string;

  summary?: string;
  aircraftType?: string;
  registrationNumber?: string;
  fatalCount?: number;
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
  if (kind === "incident") return "#fdd835"; // yellow
  return "#2196f3"; // blue for occurrence
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
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [expandedPopups, setExpandedPopups] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState<string>("");
  
  // Toggle filters for accident types (all enabled by default)
  const [showFatal, setShowFatal] = useState<boolean>(true);
  const [showAccident, setShowAccident] = useState<boolean>(true);
  const [showIncident, setShowIncident] = useState<boolean>(true);
  const [showOccurrence, setShowOccurrence] = useState<boolean>(true);

  const center: LatLngExpression = useMemo(() => [39.5, -98.35], []); // US-centered default

  // Filter points based on search term and type toggles
  const filteredPoints = useMemo(() => {
    let filtered = points;
    
    // Filter by search term
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      filtered = filtered.filter((p) => 
        p.ntsbCaseId?.toLowerCase().includes(search) ||
        p.city?.toLowerCase().includes(search) ||
        p.state?.toLowerCase().includes(search) ||
        p.aircraftType?.toLowerCase().includes(search) ||
        p.registrationNumber?.toLowerCase().includes(search)
      );
    }
    
    // Filter by accident type toggles
    filtered = filtered.filter((p) => {
      if (p.kind === "fatal" && !showFatal) return false;
      if (p.kind === "accident" && !showAccident) return false;
      if (p.kind === "incident" && !showIncident) return false;
      if (p.kind === "occurrence" && !showOccurrence) return false;
      return true;
    });
    
    return filtered;
  }, [points, searchTerm, showFatal, showAccident, showIncident, showOccurrence]);

const counts = useMemo(() => {
    let fatal = 0,
      accident = 0,
      incident = 0,
      occurrence = 0;
    for (const p of filteredPoints) {
      if (p.kind === "fatal") fatal++;
      else if (p.kind === "accident") accident++;
      else if (p.kind === "incident") incident++;
      else if (p.kind === "occurrence") occurrence++;
    }
    return { fatal, accident, incident, occurrence, total: filteredPoints.length };
  }, [filteredPoints]);

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
        className="control-panel"
        style={{
          position: "absolute",
          zIndex: 1000,
          top: 12,
          left: isPanelOpen ? 12 : -320,
          width: 320,
          padding: 14,
          borderRadius: 12,
          background: "rgba(255,255,255,0.95)",
          boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
          transition: "left 0.3s ease",
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
              onKeyDown={(e) => e.key === "Enter" && load()}
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
              onKeyDown={(e) => e.key === "Enter" && load()}
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

        {/* Quick date range filters */}
        <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button
            onClick={() => {
              const end = new Date();
              const start = new Date(end);
              start.setDate(end.getDate() - 7);
              setStart(isoDate(start));
              setEnd(isoDate(end));
              setTimeout(() => load(), 0);
            }}
            disabled={loading}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid #ddd",
              background: loading ? "#f4f4f4" : "#fff",
              cursor: loading ? "not-allowed" : "pointer",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Last Week
          </button>

          <button
            onClick={() => {
              const end = new Date();
              const start = new Date(end);
              start.setMonth(end.getMonth() - 1);
              setStart(isoDate(start));
              setEnd(isoDate(end));
              setTimeout(() => load(), 0);
            }}
            disabled={loading}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid #ddd",
              background: loading ? "#f4f4f4" : "#fff",
              cursor: loading ? "not-allowed" : "pointer",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Last Month
          </button>

          <button
            onClick={() => {
              const end = new Date();
              const start = new Date(end);
              start.setFullYear(end.getFullYear() - 1);
              setStart(isoDate(start));
              setEnd(isoDate(end));
              setTimeout(() => load(), 0);
            }}
            disabled={loading}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid #ddd",
              background: loading ? "#f4f4f4" : "#fff",
              cursor: loading ? "not-allowed" : "pointer",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Last Year
          </button>
        </div>

        {/* Search box - same as Data View */}
        {points.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <input
              type="text"
              placeholder="Search by NTSB#, location, aircraft..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid #ddd",
                fontSize: 13,
                boxSizing: "border-box",
              }}
            />
            {searchTerm && (
              <div style={{ fontSize: 12, marginTop: 4, opacity: 0.7 }}>
                Showing {counts.total} of {points.length} events
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Legend (click to filter)</div>

          <div 
            onClick={() => setShowFatal(!showFatal)}
            style={{ 
              display: "flex", 
              alignItems: "center", 
              gap: 10, 
              marginBottom: 6,
              cursor: "pointer",
              opacity: showFatal ? 1 : 0.4,
              transition: "opacity 0.2s"
            }}
          >
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: 7,
                background: colorFor("fatal"),
                display: "inline-block",
                border: showFatal ? "2px solid #333" : "2px solid #ccc",
              }}
            />
            <div style={{ fontSize: 13 }}>
              Fatal accidents (red): <b>{counts.fatal}</b>
            </div>
          </div>

          <div 
            onClick={() => setShowAccident(!showAccident)}
            style={{ 
              display: "flex", 
              alignItems: "center", 
              gap: 10, 
              marginBottom: 6,
              cursor: "pointer",
              opacity: showAccident ? 1 : 0.4,
              transition: "opacity 0.2s"
            }}
          >
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: 7,
                background: colorFor("accident"),
                display: "inline-block",
                border: showAccident ? "2px solid #333" : "2px solid #ccc",
              }}
            />
            <div style={{ fontSize: 13 }}>
              Accidents (orange): <b>{counts.accident}</b>
            </div>
          </div>

          <div 
            onClick={() => setShowIncident(!showIncident)}
            style={{ 
              display: "flex", 
              alignItems: "center", 
              gap: 10,
              cursor: "pointer",
              opacity: showIncident ? 1 : 0.4,
              transition: "opacity 0.2s"
            }}
          >
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: 7,
                background: colorFor("incident"),
                display: "inline-block",
                border: showIncident ? "2px solid #333" : "2px solid #ccc",
              }}
            />
            <div style={{ fontSize: 13 }}>
              Incidents (yellow): <b>{counts.incident}</b>
            </div>
          </div>

          <div 
            onClick={() => setShowOccurrence(!showOccurrence)}
            style={{ 
              display: "flex", 
              alignItems: "center", 
              gap: 10, 
              marginTop: 6,
              cursor: "pointer",
              opacity: showOccurrence ? 1 : 0.4,
              transition: "opacity 0.2s"
            }}
          >
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: 7,
                background: colorFor("occurrence"),
                display: "inline-block",
                border: showOccurrence ? "2px solid #333" : "2px solid #ccc",
              }}
            />
            <div style={{ fontSize: 13 }}>
              Occurrences (blue): <b>{counts.occurrence}</b>
            </div>
          </div>
        </div>
      </div>

      {/* Panel toggle button - mobile only */}
      <button
        className="panel-toggle"
        onClick={() => setIsPanelOpen(!isPanelOpen)}
        style={{
          position: "absolute",
          top: "20%",
          left: isPanelOpen ? 330 : 0,
          transform: "translateY(-50%)",
          zIndex: 1001,
          background: "white",
          border: "2px solid #ddd",
          borderLeft: "none",
          borderRadius: "0 8px 8px 0",
          padding: "20px 6px",
          cursor: "pointer",
          boxShadow: "2px 0 8px rgba(0,0,0,0.15)",
          fontSize: 14,
          transition: "left 0.3s ease",
          display: "none",
          writingMode: "vertical-rl",
          textOrientation: "mixed",
        }}
      >
        {isPanelOpen ? "◀" : "▶"}
      </button>

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

        {filteredPoints.map((p) => {
          // Build title: "Accident/Incident [Tail Number] - [Aircraft Type]"
          const eventTypeLabel = 
            p.kind === "fatal" ? "Fatal Accident" :
            p.kind === "accident" ? "Accident" :
            p.kind === "incident" ? "Incident" : "Occurrence";
          
          const tailNumber = p.registrationNumber ? ` ${p.registrationNumber}` : "";
          const aircraftType = p.aircraftType ? ` - ${p.aircraftType}` : "";
          const title = `${eventTypeLabel}${tailNumber}${aircraftType}`;

          // Docket link (always available)
          const docketUrl = p.ntsbCaseId
            ? `https://data.ntsb.gov/Docket/?NTSBNumber=${encodeURIComponent(String(p.ntsbCaseId).trim())}`
            : undefined;

          // Accident Report link - direct PDF
          const reportUrl = p.eventId
            ? `https://data.ntsb.gov/carol-repgen/api/Aviation/ReportMain/GenerateNewestReport/${p.eventId}/pdf`
            : undefined;

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
              <Popup autoPan={false} closeOnClick={false}>
                <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" }}>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>
                    {title}
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
                    {p.fatalCount !== undefined && p.fatalCount > 0 ? (
                      <div>
                        <b>Fatalities:</b> {p.fatalCount}
                      </div>
                    ) : null}
                  </div>

                  {p.summary ? (
                    <div style={{ fontSize: 12, opacity: 0.9, marginBottom: 8 }}>
                      {expandedPopups.has(p.id) 
                        ? p.summary
                        : shortNarrative(p.summary, 320)}
                      {" "}
                      {shortNarrative(p.summary, 320).endsWith("…") && (
                        <span
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setExpandedPopups(prev => {
                              const next = new Set(prev);
                              if (next.has(p.id)) {
                                next.delete(p.id);
                              } else {
                                next.add(p.id);
                              }
                              return next;
                            });
                          }}
                          style={{
                            color: "#2563eb",
                            cursor: "pointer",
                            fontSize: 12,
                            fontWeight: 700,
                            textDecoration: "underline"
                          }}
                        >
                          {expandedPopups.has(p.id) ? "[show less]" : "[...]"}
                        </span>
                      )}
                    </div>
                  ) : null}

                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    {reportUrl ? (
                      <a href={reportUrl} target="_blank" rel="noreferrer" style={{ fontWeight: 800 }}>
                        Investigation →
                      </a>
                    ) : null}

                    {docketUrl ? (
                      <a href={docketUrl} target="_blank" rel="noreferrer" style={{ fontWeight: 800 }}>
                        Docket →
                      </a>
                    ) : null}
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>

      {/* Mobile styles */}
      <style jsx global>{`
        @media (max-width: 768px) {
          .control-panel {
            top: 0 !important;
            left: ${isPanelOpen ? "0" : "-320px"} !important;
            border-radius: 0 0 12px 0 !important;
            width: 100vw !important;
            max-width: 320px !important;
          }

          .panel-toggle {
            display: block !important;
          }
        }
      `}</style>
    </div>
  );
}