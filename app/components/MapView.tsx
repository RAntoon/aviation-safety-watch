"use client";

import React, { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";

type NtsbPoint = {
  id: string;
  lat: number;
  lon: number;
  title: string;
  date?: string;
  cityState?: string;
  ntsbNumber?: string;
};

function ymd(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function defaultRangeLast12Months() {
  const end = new Date();
  const start = new Date(end);
  start.setFullYear(end.getFullYear() - 1);
  return { start: ymd(start), end: ymd(end) };
}

export default function MapView() {
  const defaults = useMemo(() => defaultRangeLast12Months(), []);
  const [start, setStart] = useState(defaults.start);
  const [end, setEnd] = useState(defaults.end);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [meta, setMeta] = useState<{ fetchedAt?: string; urlUsed?: string }>({});
  const [points, setPoints] = useState<NtsbPoint[]>([]);

  async function load() {
    setLoading(true);
    setError("");
    setPoints([]);

    try {
      const res = await fetch(`/api/ntsb?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, {
        cache: "no-store",
      });

      const json = await res.json();

      if (!res.ok || !json?.ok) {
        // show the useful error details in UI
        setError(
          `${json?.message || "Fetch failed"} (${res.status}). ${
            json?.error?.status ? `Upstream status: ${json.error.status}. ` : ""
          }${
            json?.error?.bodyPreview ? `Preview: ${json.error.bodyPreview}` : ""
          }`
        );
        return;
      }

      setMeta({ fetchedAt: json.fetchedAt, urlUsed: json.urlUsed });

      // ---- IMPORTANT ----
      // NTSB schema can vary; we only plot points that have real coordinates.
      // We'll try to discover common field names safely.

      const raw = json.data;

      // Some endpoints return { results: [...] }, some return plain array, etc.
      const rows: any[] =
        Array.isArray(raw) ? raw :
        Array.isArray(raw?.results) ? raw.results :
        Array.isArray(raw?.Result) ? raw.Result :
        Array.isArray(raw?.data) ? raw.data :
        [];

      const mapped: NtsbPoint[] = [];

      for (const r of rows) {
        // best-effort coordinate extraction (only accept real numbers)
        const lat =
          Number(r?.latitude ?? r?.Latitude ?? r?.lat ?? r?.Lat ?? r?.Location?.Latitude);
        const lon =
          Number(r?.longitude ?? r?.Longitude ?? r?.lon ?? r?.Lon ?? r?.Location?.Longitude);

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

        const ntsbNumber =
          String(r?.ntsbNumber ?? r?.NtsbNumber ?? r?.NTSBNumber ?? r?.caseNumber ?? r?.CaseNumber ?? "").trim() || undefined;

        const date =
          String(r?.eventDate ?? r?.EventDate ?? r?.accidentDate ?? r?.AccidentDate ?? r?.OccurrenceDate ?? "").trim() || undefined;

        const city = String(r?.city ?? r?.City ?? r?.locationCity ?? "").trim();
        const state = String(r?.state ?? r?.State ?? r?.locationState ?? "").trim();
        const cityState = [city, state].filter(Boolean).join(", ") || undefined;

        const title =
          String(r?.airport ?? r?.Airport ?? r?.AircraftMake ?? r?.aircraftMake ?? r?.AircraftModel ?? r?.aircraftModel ?? "Aviation case").trim() ||
          "Aviation case";

        mapped.push({
          id: ntsbNumber || `${lat},${lon},${date || ""}`,
          lat,
          lon,
          title,
          date,
          cityState,
          ntsbNumber,
        });
      }

      setPoints(mapped);
      if (mapped.length === 0) {
        setError(
          "NTSB returned data, but none of the cases included usable coordinates to plot. (We only plot real lat/lon.)"
        );
      }
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  // auto-load on first render
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ height: "100vh", width: "100vw" }}>
      {/* Control panel */}
      <div
        style={{
          position: "absolute",
          zIndex: 1000,
          top: 12,
          left: 12,
          background: "white",
          padding: 12,
          borderRadius: 10,
          boxShadow: "0 2px 12px rgba(0,0,0,0.12)",
          minWidth: 320,
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
          fontSize: 14,
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Aviation Safety Watch (MVP)</div>
        <div style={{ marginBottom: 8 }}>
          Data source: <b>NTSB Public API</b> · Default range: <b>last 12 months</b>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Start</div>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              style={{ padding: 6 }}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>End</div>
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              style={{ padding: 6 }}
            />
          </div>
          <button
            onClick={load}
            disabled={loading}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #ddd",
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Loading…" : "Reload"}
          </button>
        </div>

        <div>Dots shown: <b>{points.length}</b></div>
        {meta.fetchedAt && (
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
            Updated: {new Date(meta.fetchedAt).toLocaleString()}
          </div>
        )}
        {error && (
          <div style={{ marginTop: 8, color: "#b00020", whiteSpace: "pre-wrap" }}>
            {error}
          </div>
        )}
      </div>

      {/* Map */}
      <MapContainer
        center={[39.5, -98.35]} // continental US
        zoom={4}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {points.map((p) => (
          <CircleMarker
            key={p.id}
            center={[p.lat, p.lon]}
            radius={6}
            pathOptions={{}}
          >
            <Popup>
              <div style={{ minWidth: 220 }}>
                <div style={{ fontWeight: 700 }}>{p.title}</div>
                {p.date && <div>Date: {p.date}</div>}
                {p.cityState && <div>Location: {p.cityState}</div>}
                {p.ntsbNumber ? (
                  <div style={{ marginTop: 6 }}>
                    NTSB #: <b>{p.ntsbNumber}</b>
                    <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                      (If you want, we can add a verified deep-link to the NTSB case page next.)
                    </div>
                  </div>
                ) : (
                  <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                    No NTSB number field detected in this record.
                  </div>
                )}
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
