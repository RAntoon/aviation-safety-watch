// app/components/MapView.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";

// Dynamically import react-leaflet components to avoid SSR/window issues
const MapContainer: any = dynamic(() => import("react-leaflet").then((m) => m.MapContainer as any), { ssr: false });
const TileLayer: any = dynamic(() => import("react-leaflet").then((m) => m.TileLayer as any), { ssr: false });
const CircleMarker: any = dynamic(() => import("react-leaflet").then((m) => m.CircleMarker as any), { ssr: false });
const Popup: any = dynamic(() => import("react-leaflet").then((m) => m.Popup as any), { ssr: false });

type NtsbPoint = {
  id: string;
  title: string;
  date?: string;
  city?: string;
  state?: string;
  lat: number;
  lon: number;
  url?: string;
};

function toISODate(d: Date) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function last12MonthsRange() {
  const end = new Date();
  const start = new Date(end);
  start.setUTCFullYear(end.getUTCFullYear() - 1);
  return { start: toISODate(start), end: toISODate(end) };
}

// Best-effort extractor because NTSB response shape can vary across endpoints/versions
function extractCases(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;

  // common wrappers
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.Cases)) return payload.Cases;
  if (Array.isArray(payload.cases)) return payload.cases;

  // sometimes nested one level down
  if (payload.Result && Array.isArray(payload.Result)) return payload.Result;
  if (payload.Result && Array.isArray(payload.Result.results)) return payload.Result.results;

  // fallback: try to find the first array inside object
  for (const k of Object.keys(payload)) {
    if (Array.isArray(payload[k])) return payload[k];
  }
  return [];
}

function pickNumber(v: any): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeToPoints(rawCases: any[]): NtsbPoint[] {
  const out: NtsbPoint[] = [];

  for (const c of rawCases) {
    // try common fields
    const lat =
      pickNumber(c?.Latitude) ??
      pickNumber(c?.latitude) ??
      pickNumber(c?.Lat) ??
      pickNumber(c?.lat) ??
      null;

    const lon =
      pickNumber(c?.Longitude) ??
      pickNumber(c?.longitude) ??
      pickNumber(c?.Lon) ??
      pickNumber(c?.lon) ??
      null;

    if (lat === null || lon === null) continue;

    const ntsbNo =
      c?.NtsbNumber ||
      c?.ntsbNumber ||
      c?.NTSBNumber ||
      c?.CaseNumber ||
      c?.caseNumber ||
      c?.EventId ||
      c?.eventId ||
      c?.MKey ||
      c?.mkey ||
      c?.MKEY ||
      "";

    const date =
      c?.EventDate ||
      c?.eventDate ||
      c?.OccurrenceDate ||
      c?.occurrenceDate ||
      c?.AccidentDate ||
      c?.accidentDate ||
      "";

    const city = c?.City || c?.city || "";
    const state = c?.State || c?.state || "";

    const aircraft = c?.Make || c?.make || c?.AircraftMake || "";
    const model = c?.Model || c?.model || c?.AircraftModel || "";
    const titleParts = [
      ntsbNo ? `NTSB ${ntsbNo}` : "NTSB Case",
      aircraft || model ? `— ${[aircraft, model].filter(Boolean).join(" ")}` : "",
    ].filter(Boolean);

    // This is a reasonable public link pattern you can later refine:
    // If you prefer, just remove it and only show text.
    const url = ntsbNo ? `https://www.ntsb.gov/Pages/Results.aspx?queryId=${encodeURIComponent(ntsbNo)}` : undefined;

    out.push({
      id: String(ntsbNo || `${lat},${lon},${date}`),
      title: titleParts.join(" "),
      date: date ? String(date) : undefined,
      city: city ? String(city) : undefined,
      state: state ? String(state) : undefined,
      lat,
      lon,
      url,
    });
  }

  return out;
}

export default function MapView() {
  const defaults = useMemo(() => last12MonthsRange(), []);
  const [start, setStart] = useState(defaults.start);
  const [end, setEnd] = useState(defaults.end);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [points, setPoints] = useState<NtsbPoint[]>([]);
  const [meta, setMeta] = useState<{ endpointUsed?: string; source?: string } | null>(null);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/ntsb?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, {
        cache: "no-store",
      });
      const json = await res.json();

      if (!json?.ok) {
        setPoints([]);
        setMeta(null);
        setError(`NTSB fetch failed (${res.status}). Check server response in /api/ntsb.`);
        return;
      }

      const rawCases = extractCases(json.data);
      const pts = normalizeToPoints(rawCases);

      setPoints(pts);
      setMeta({ endpointUsed: json.endpointUsed, source: json.source });
    } catch (e: any) {
      setPoints([]);
      setMeta(null);
      setError(e?.message || "Unknown fetch error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // default: last 12 months auto-load
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ height: "100vh", width: "100vw", position: "relative" }}>
      {/* Controls */}
      <div
        style={{
          position: "absolute",
          zIndex: 1000,
          top: 12,
          left: 12,
          background: "rgba(255,255,255,0.95)",
          padding: 12,
          borderRadius: 10,
          boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
          minWidth: 320,
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Aviation Safety Watch (MVP)</div>

        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 10 }}>
          Data source: <b>NTSB Public API</b> • Default range: last 12 months
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, opacity: 0.8 }}>Start</label>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid #ddd" }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, opacity: 0.8 }}>End</label>
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid #ddd" }}
            />
          </div>

          <button
            onClick={load}
            disabled={loading}
            style={{
              marginTop: 18,
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: loading ? "#f5f5f5" : "white",
              cursor: loading ? "default" : "pointer",
              fontWeight: 600,
            }}
          >
            {loading ? "Loading…" : "Reload"}
          </button>
        </div>

        <div style={{ fontSize: 12 }}>
          Dots shown: <b>{points.length}</b>
        </div>

        {meta?.endpointUsed ? (
          <div style={{ marginTop: 6, fontSize: 11, opacity: 0.75, wordBreak: "break-all" }}>
            Endpoint used: {meta.endpointUsed}
          </div>
        ) : null}

        {error ? (
          <div style={{ marginTop: 8, fontSize: 12, color: "#b00020" }}>
            {error}
          </div>
        ) : null}
      </div>

      {/* Map */}
      <MapContainer center={[39.5, -98.35]} zoom={4} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
        <TileLayer
          // OpenStreetMap tiles (map background)
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
        />

        {points.map((p) => (
          <CircleMarker
            key={p.id}
            center={[p.lat, p.lon]}
            radius={6}
            pathOptions={{}}
          >
            <Popup>
              <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial", minWidth: 220 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{p.title}</div>
                {p.date ? <div style={{ fontSize: 12 }}>Date: {p.date}</div> : null}
                {(p.city || p.state) ? (
                  <div style={{ fontSize: 12 }}>
                    Location: {[p.city, p.state].filter(Boolean).join(", ")}
                  </div>
                ) : null}

                <div style={{ fontSize: 12, marginTop: 6 }}>
                  Lat/Lon: {p.lat.toFixed(4)}, {p.lon.toFixed(4)}
                </div>

                {p.url ? (
                  <div style={{ marginTop: 8 }}>
                    <a href={p.url} target="_blank" rel="noreferrer">
                      Open in NTSB search
                    </a>
                  </div>
                ) : null}
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
