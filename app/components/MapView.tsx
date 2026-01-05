"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  ZoomControl,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix default marker icons in Next.js (otherwise markers can be invisible)
const DefaultIcon = L.icon({
  iconUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

type ApiResponse = {
  ok: boolean;
  start: string;
  end: string;
  source?: string;
  fetchedAt?: string;
  urlUsed?: string;
  count?: number;
  data?: any[];
  message?: string;
  error?: any;
};

function toYMD(d: Date) {
  // YYYY-MM-DD (this is what <input type="date"> expects)
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function last12MonthsRange() {
  const end = new Date();
  const start = new Date(end);
  start.setFullYear(end.getFullYear() - 1);
  return { start: toYMD(start), end: toYMD(end) };
}

function pickLatLng(row: any): { lat: number; lng: number } | null {
  // NTSB fields vary by record type; try a bunch of common keys
  const candidates = [
    ["Latitude", "Longitude"],
    ["latitude", "longitude"],
    ["Lat", "Long"],
    ["lat", "lng"],
    ["lat", "lon"],
    ["LocationLatitude", "LocationLongitude"],
    ["locationLatitude", "locationLongitude"],
  ] as const;

  for (const [a, b] of candidates) {
    const lat = Number(row?.[a]);
    const lng = Number(row?.[b]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng };
    }
  }
  return null;
}

function titleFor(row: any) {
  return (
    row?.AirportName ||
    row?.airportName ||
    row?.Location ||
    row?.location ||
    row?.City ||
    row?.city ||
    row?.State ||
    row?.state ||
    row?.Country ||
    row?.country ||
    "NTSB Aviation Case"
  );
}

function dateFor(row: any) {
  return (
    row?.EventDate ||
    row?.eventDate ||
    row?.AccidentDate ||
    row?.accidentDate ||
    row?.OccurrenceDate ||
    row?.occurrenceDate ||
    row?.Date ||
    row?.date ||
    ""
  );
}

function ntsbNumberFor(row: any) {
  return (
    row?.NtsbNumber ||
    row?.ntsbNumber ||
    row?.NTSBNumber ||
    row?.CaseNumber ||
    row?.caseNumber ||
    ""
  );
}

export default function MapView() {
  const usCenter: [number, number] = [39.5, -98.35];

  const defaults = useMemo(() => last12MonthsRange(), []);
  const [start, setStart] = useState<string>(defaults.start);
  const [end, setEnd] = useState<string>(defaults.end);

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [dots, setDots] = useState<
    { lat: number; lng: number; row: any }[]
  >([]);

  async function load() {
    setLoading(true);
    setStatus("Loading…");
    try {
      const url = `/api/ntsb?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
      const res = await fetch(url, { cache: "no-store" });
      const json = (await res.json()) as ApiResponse;

      if (!res.ok || !json.ok) {
        setDots([]);
        setStatus(
          `NTSB fetch failed (${res.status}). Check server response in /api/ntsb.`
        );
        return;
      }

      const rows = Array.isArray(json.data) ? json.data : [];
      const mapped: { lat: number; lng: number; row: any }[] = [];
      for (const row of rows) {
        const ll = pickLatLng(row);
        if (ll) mapped.push({ ...ll, row });
      }

      setDots(mapped);
      setStatus(`OK. Dots shown: ${mapped.length}`);
    } catch (e: any) {
      setDots([]);
      setStatus(`Fetch error. ${String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  // load on first render + when date changes if you want auto-refresh
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ height: "100vh", width: "100%" }}>
      <MapContainer
        center={usCenter}
        zoom={4}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
        zoomControl={false} // we'll place it separately
      >
        {/* Zoom buttons moved away from the panel */}
        <ZoomControl position="topright" />

        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          // react-leaflet v4 TS can be picky about this prop; safe to omit if it ever complains
          attribution="&copy; OpenStreetMap contributors"
        />

        {/* Control panel (top-left) */}
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            zIndex: 1000,
            background: "rgba(255,255,255,0.95)",
            padding: 12,
            borderRadius: 10,
            boxShadow: "0 2px 10px rgba(0,0,0,0.15)",
            width: 320,
            fontFamily:
              'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial',
            fontSize: 14,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            Aviation Safety Watch (MVP)
          </div>
          <div style={{ opacity: 0.8, marginBottom: 10 }}>
            Data source: NTSB Public API · Default range: last 12 months
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label>
              <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>Start</div>
              <input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                style={{ width: "100%", padding: "6px 8px" }}
              />
            </label>
            <label>
              <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>End</div>
              <input
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                style={{ width: "100%", padding: "6px 8px" }}
              />
            </label>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center" }}>
            <button
              onClick={load}
              disabled={loading}
              style={{
                padding: "7px 10px",
                borderRadius: 8,
                border: "1px solid rgba(0,0,0,0.2)",
                background: loading ? "#eee" : "#fff",
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Loading…" : "Reload"}
            </button>
            <div style={{ opacity: 0.85 }}>Dots shown: {dots.length}</div>
          </div>

          <div style={{ marginTop: 10, fontSize: 13 }}>
            <b>Status:</b> {status}
          </div>
        </div>

        {dots.map((d, idx) => {
          const row = d.row;
          const t = titleFor(row);
          const dt = dateFor(row);
          const ntsbNo = ntsbNumberFor(row);

          // A reasonable “details” link: your own API can proxy details later,
          // or you can search by ntsb number on NTSB sites.
          const detailsLink = ntsbNo
            ? `https://www.ntsb.gov/Pages/search.aspx?query=${encodeURIComponent(ntsbNo)}`
            : null;

          return (
            <Marker key={`${idx}-${d.lat}-${d.lng}`} position={[d.lat, d.lng]}>
              <Popup>
                <div style={{ minWidth: 220 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>{t}</div>
                  {dt ? <div style={{ marginBottom: 6 }}>Date: {String(dt)}</div> : null}
                  {ntsbNo ? <div style={{ marginBottom: 6 }}>NTSB #: {String(ntsbNo)}</div> : null}
                  <div style={{ marginBottom: 6 }}>
                    Lat/Lng: {d.lat.toFixed(4)}, {d.lng.toFixed(4)}
                  </div>
                  {detailsLink ? (
                    <a href={detailsLink} target="_blank" rel="noreferrer">
                      Open details
                    </a>
                  ) : (
                    <div style={{ opacity: 0.7 }}>No NTSB number in record</div>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
