"use client";

// @ts-nocheck
import React, { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
  ZoomControl,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";

type Dot = {
  id: string;
  lat: number;
  lon: number;
  title: string;
  url?: string;
  when?: string;
};

function toInputDate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function last12MonthsDefault() {
  const end = new Date();
  const start = new Date(end);
  start.setFullYear(end.getFullYear() - 1);
  return { start, end };
}

function safeNumber(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * NTSB payload shape varies a bit; we’ll try to extract lat/lon and a reasonable label.
 * If you later want “only accidents” vs “all cases”, we can filter once we see fields.
 */
function extractDots(ntsbData: any): Dot[] {
  const rows: any[] =
    ntsbData?.data?.data ??
    ntsbData?.data?.Data ??
    ntsbData?.data ??
    ntsbData?.Data ??
    [];

  if (!Array.isArray(rows)) return [];

  const dots: Dot[] = [];

  for (const r of rows) {
    const lat =
      safeNumber(r?.Latitude) ??
      safeNumber(r?.latitude) ??
      safeNumber(r?.Lat) ??
      safeNumber(r?.lat);

    const lon =
      safeNumber(r?.Longitude) ??
      safeNumber(r?.longitude) ??
      safeNumber(r?.Lon) ??
      safeNumber(r?.lon) ??
      safeNumber(r?.Long);

    if (lat == null || lon == null) continue;

    const id =
      String(r?.NtsbNumber ?? r?.ntsbNumber ?? r?.MKey ?? r?.mkey ?? `${lat},${lon}`);

    const title =
      String(
        r?.EventCity ??
          r?.eventCity ??
          r?.Location ??
          r?.location ??
          r?.AirportName ??
          r?.airportName ??
          r?.NtsbNumber ??
          r?.ntsbNumber ??
          "NTSB Case"
      );

    const when =
      String(r?.EventDate ?? r?.eventDate ?? r?.OccurrenceDate ?? r?.occurrenceDate ?? "");

    // Optional: if they provide a case URL later, wire it here
    dots.push({ id, lat, lon, title, when });
  }

  return dots;
}

export default function MapView() {
  const usCenter: [number, number] = useMemo(() => [39.5, -98.35], []);
  const { start: dStart, end: dEnd } = useMemo(() => last12MonthsDefault(), []);

  const [start, setStart] = useState(toInputDate(dStart));
  const [end, setEnd] = useState(toInputDate(dEnd));

  const [status, setStatus] = useState<string>("Idle");
  const [dots, setDots] = useState<Dot[]>([]);
  const [sourceLine, setSourceLine] = useState<string>(
    "Data source: NTSB Public API • Default range: last 12 months"
  );

  async function load() {
    setStatus("Loading…");
    setDots([]);

    try {
      const res = await fetch(`/api/ntsb?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, {
        cache: "no-store",
      });
      const json = await res.json();

      if (!res.ok || !json?.ok) {
        console.error("NTSB /api/ntsb error payload:", json);
        setStatus(`NTSB fetch failed (${res.status}). Check server response in /api/ntsb.`);
        return;
      }

      setSourceLine(
        `Data source: ${json.source || "NTSB Public API"} • URL used: ${json.urlUsed || ""}`
      );

      const extracted = extractDots(json);
      setDots(extracted);
      setStatus("OK");
    } catch (e: any) {
      console.error(e);
      setStatus("NTSB fetch failed (network/runtime). Check console.");
    }
  }

  useEffect(() => {
    // auto-load on first render using default last 12 months
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ height: "100vh", width: "100%", position: "relative" }}>
      <MapContainer
        center={usCenter}
        zoom={4}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
        zoomControl={false} // we’ll place it ourselves
      >
        {/* Put zoom buttons TOP-RIGHT so they don't overlap your panel */}
        <ZoomControl position="topright" />

        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
        />

        {dots.map((d) => (
          <CircleMarker
            key={d.id}
            center={[d.lat, d.lon]}
            radius={5}
            pathOptions={{}}
          >
            <Popup>
              <div style={{ minWidth: 220 }}>
                <div style={{ fontWeight: 700 }}>{d.title}</div>
                {d.when ? <div style={{ marginTop: 6 }}>Date: {d.when}</div> : null}
                <div style={{ marginTop: 6 }}>
                  {d.lat.toFixed(4)}, {d.lon.toFixed(4)}
                </div>
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>

      {/* Filter panel (TOP-LEFT) */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 9999,
          background: "rgba(255,255,255,0.95)",
          padding: 12,
          borderRadius: 10,
          boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
          width: 320,
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 18 }}>Aviation Safety Watch (MVP)</div>
        <div style={{ marginTop: 4, fontSize: 12, opacity: 0.8 }}>{sourceLine}</div>

        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, marginBottom: 4 }}>Start</div>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              style={{ width: "100%", padding: 6 }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, marginBottom: 4 }}>End</div>
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              style={{ width: "100%", padding: 6 }}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}>
          <button
            onClick={load}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #ccc",
              background: "#fff",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Reload
          </button>
          <div style={{ fontSize: 12, opacity: 0.8 }}>Dots shown: {dots.length}</div>
        </div>

        <div style={{ marginTop: 10, fontSize: 12 }}>
          Status:{" "}
          <span style={{ fontWeight: 700, color: status.startsWith("NTSB fetch failed") ? "#b00020" : "#111" }}>
            {status}
          </span>
        </div>
      </div>
    </div>
  );
}
