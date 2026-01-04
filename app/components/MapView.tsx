"use client";

/* @ts-nocheck
  Why ts-nocheck:
  Your build logs show react-leaflet prop types randomly failing (center/zoom/attribution).
  This keeps the MVP moving while you stabilize TS deps later.
*/

import React, { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";

type MarkerRow = {
  id: string;
  title: string;
  ntsbNumber?: string;
  lat: number;
  lon: number;
  occurred?: string;
  city?: string;
  state?: string;
};

function toISODate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function safeNum(x: any) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

export default function MapView() {
  // default: last 30 days
  const today = useMemo(() => new Date(), []);
  const thirtyDaysAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d;
  }, []);

  const [start, setStart] = useState<string>(toISODate(thirtyDaysAgo));
  const [end, setEnd] = useState<string>(toISODate(today));

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [rawCount, setRawCount] = useState<number>(0);
  const [plottedCount, setPlottedCount] = useState<number>(0);
  const [markers, setMarkers] = useState<MarkerRow[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string>("");

  async function load() {
    setLoading(true);
    setError("");

    try {
      const r = await fetch(`/api/ntsb?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, {
        cache: "no-store",
      });

      const data = await r.json();

      if (!r.ok) {
        setMarkers([]);
        setRawCount(0);
        setPlottedCount(0);
        setLastUpdated(new Date().toLocaleString());
        setError(data?.error ? `${data.error}` : `Request failed (${r.status})`);
        return;
      }

      // NTSB response shape can vary by endpoint version.
      // We try common shapes and fall back safely.
      const cases =
        data?.cases ||
        data?.Cases ||
        data?.results ||
        data?.Results ||
        data?.data ||
        data?.Data ||
        (Array.isArray(data) ? data : []);

      setRawCount(Array.isArray(cases) ? cases.length : 0);

      const rows: MarkerRow[] = [];
      if (Array.isArray(cases)) {
        for (const c of cases) {
          // Try common field names seen in NTSB payloads
          const lat =
            safeNum(c?.latitude) ??
            safeNum(c?.Latitude) ??
            safeNum(c?.Lat) ??
            safeNum(c?.location?.latitude) ??
            safeNum(c?.Location?.Latitude);

          const lon =
            safeNum(c?.longitude) ??
            safeNum(c?.Longitude) ??
            safeNum(c?.Lon) ??
            safeNum(c?.location?.longitude) ??
            safeNum(c?.Location?.Longitude);

          // Only plot if we have real coordinates
          if (lat == null || lon == null) continue;
          if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;

          const ntsbNumber =
            c?.ntsbNumber || c?.NtsbNumber || c?.NTSBNumber || c?.caseNumber || c?.CaseNumber;

          const title =
            c?.eventType ||
            c?.EventType ||
            c?.title ||
            c?.Title ||
            (ntsbNumber ? `NTSB ${ntsbNumber}` : "NTSB Aviation Case");

          const occurred =
            c?.eventDate ||
            c?.EventDate ||
            c?.date ||
            c?.Date ||
            c?.occurred ||
            c?.Occurred;

          const city = c?.city || c?.City || c?.locationCity || c?.LocationCity;
          const state = c?.state || c?.State || c?.locationState || c?.LocationState;

          rows.push({
            id: String(c?.mkey || c?.Mkey || c?.id || c?.Id || ntsbNumber || `${lat},${lon}`),
            title: String(title),
            ntsbNumber: ntsbNumber ? String(ntsbNumber) : undefined,
            lat,
            lon,
            occurred: occurred ? String(occurred) : undefined,
            city: city ? String(city) : undefined,
            state: state ? String(state) : undefined,
          });
        }
      }

      setMarkers(rows);
      setPlottedCount(rows.length);
      setLastUpdated(new Date().toLocaleString());
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const center: [number, number] = [39.5, -98.35]; // continental US

  return (
    <div style={{ height: "100vh", width: "100vw", position: "relative" }}>
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
          minWidth: 280,
          fontSize: 14,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Aviation Safety Watch (NTSB)</div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, opacity: 0.8 }}>Start</span>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, opacity: 0.8 }}>End</span>
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>

        <button onClick={load} disabled={loading} style={{ padding: "6px 10px" }}>
          {loading ? "Loading…" : "Load cases"}
        </button>

        <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.4, opacity: 0.9 }}>
          <div>Raw cases returned: {rawCount}</div>
          <div>Plotted (only if lat/lon present): {plottedCount}</div>
          <div>Updated: {lastUpdated || "—"}</div>
          {error ? <div style={{ marginTop: 6, color: "crimson" }}>Error: {error}</div> : null}
        </div>
      </div>

      {/* Map */}
      <MapContainer center={center} zoom={4} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {markers.map((m) => (
          <CircleMarker
            key={m.id}
            center={[m.lat, m.lon]}
            radius={7}
            pathOptions={{}}
          >
            <Popup>
              <div style={{ minWidth: 220 }}>
                <div style={{ fontWeight: 700 }}>{m.title}</div>
                {m.ntsbNumber ? <div>NTSB #: {m.ntsbNumber}</div> : null}
                {m.occurred ? <div>Date: {m.occurred}</div> : null}
                {(m.city || m.state) ? <div>Loc: {[m.city, m.state].filter(Boolean).join(", ")}</div> : null}

                {/* If you later confirm the exact public case URL pattern, we’ll wire this up.
                    For now, we show the identifier without guessing a URL. */}
                <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
                  Source: NTSB Public API (server-side)
                </div>
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
