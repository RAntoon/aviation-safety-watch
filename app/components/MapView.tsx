// @ts-nocheck
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
  ZoomControl,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

type NtsbCase = any;

function toYMD(d: Date) {
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

export default function MapView() {
  // Default range: last 12 months
  const defaultRange = useMemo(() => {
    const r = last12MonthsRange();
    return { start: toYMD(r.start), end: toYMD(r.end) };
  }, []);

  const [start, setStart] = useState(defaultRange.start);
  const [end, setEnd] = useState(defaultRange.end);

  const [status, setStatus] = useState<string>("Idle");
  const [cases, setCases] = useState<NtsbCase[]>([]);
  const [error, setError] = useState<string>("");

  // Fix Leaflet marker icon paths in bundlers (prevents missing-marker icons)
  useEffect(() => {
    // Only run in browser
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const iconRetinaUrl = require("leaflet/dist/images/marker-icon-2x.png");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const iconUrl = require("leaflet/dist/images/marker-icon.png");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const shadowUrl = require("leaflet/dist/images/marker-shadow.png");

    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl,
      iconUrl,
      shadowUrl,
    });
  }, []);

  async function load() {
    setError("");
    setStatus("Loading...");
    setCases([]);

    try {
      const res = await fetch(`/api/ntsb?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
      const json = await res.json();

      if (!res.ok || !json?.ok) {
        setStatus("Error");
        setError(
          `${json?.message || "NTSB fetch failed"} (${res.status}). Check server response in /api/ntsb.`
        );
        return;
      }

      // The API format can vary; we keep it flexible and then normalize.
      const raw = json.data;

      // Try a few common shapes:
      const list =
        raw?.cases ||
        raw?.Cases ||
        raw?.results ||
        raw?.Results ||
        raw ||
        [];

      // Normalize to items that have coords (best effort).
      const normalized = (Array.isArray(list) ? list : []).map((c: any) => {
        const lat =
          c?.latitude ?? c?.Latitude ?? c?.lat ?? c?.Lat ?? c?.Location?.Latitude;
        const lon =
          c?.longitude ?? c?.Longitude ?? c?.lon ?? c?.Lon ?? c?.Location?.Longitude;

        return {
          ...c,
          _lat: typeof lat === "string" ? parseFloat(lat) : lat,
          _lon: typeof lon === "string" ? parseFloat(lon) : lon,
        };
      });

      // Only keep items with valid coordinates
      const withCoords = normalized.filter(
        (c: any) =>
          typeof c._lat === "number" &&
          Number.isFinite(c._lat) &&
          typeof c._lon === "number" &&
          Number.isFinite(c._lon)
      );

      setCases(withCoords);
      setStatus("OK");
    } catch (e: any) {
      setStatus("Error");
      setError(String(e));
    }
  }

  // Auto-load on first mount
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const center: [number, number] = [39.5, -98.35];

  return (
    <div style={{ position: "relative", height: "100vh", width: "100%" }}>
      {/* Search / status panel (top-left) */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 1000,
          width: 360,
          background: "rgba(255,255,255,0.96)",
          borderRadius: 10,
          padding: 12,
          boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
          fontFamily:
            "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 6 }}>
          Aviation Safety Watch (MVP)
        </div>

        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 10 }}>
          Data source: NTSB Public API • Default range: last 12 months
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "end" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, marginBottom: 4 }}>Start</div>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #ccc" }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, marginBottom: 4 }}>End</div>
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #ccc" }}
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
          <div style={{ fontSize: 13 }}>
            Dots shown: <b>{cases.length}</b>
          </div>
        </div>

        <div style={{ marginTop: 10, fontSize: 13 }}>
          <b>Status:</b> {status}{" "}
          {error ? (
            <div style={{ marginTop: 6, color: "#b00020", fontWeight: 600 }}>
              {error}
            </div>
          ) : null}
        </div>
      </div>

      {/* Map */}
      <MapContainer
        center={center}
        zoom={4}
        scrollWheelZoom
        zoomControl={false} // <-- we’ll add ZoomControl separately to keep it away from the panel
        style={{ height: "100%", width: "100%" }}
      >
        {/* Put zoom buttons in top-right so they don’t overlap your panel */}
        <ZoomControl position="topright" />

        <TileLayer
          // NOTE: react-leaflet v4 uses `attribution` (we’re TS-nocheck’ing anyway)
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {cases.map((c: any, idx: number) => {
          const lat = c._lat;
          const lon = c._lon;

          const title =
            c?.eventDescription ||
            c?.EventDescription ||
            c?.narrative ||
            c?.Narrative ||
            c?.city ||
            c?.City ||
            c?.state ||
            c?.State ||
            "NTSB Case";

          // If you have a known case-id field, we’ll make this smarter later.
          const ntsbNo =
            c?.ntsbNumber || c?.NtsbNumber || c?.NTSBNumber || c?.caseNumber;

          return (
            <CircleMarker
              key={`${idx}-${lat}-${lon}`}
              center={[lat, lon]}
              radius={5}
              pathOptions={{}}
            >
              <Popup>
                <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial" }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>{title}</div>
                  <div style={{ fontSize: 13, marginBottom: 6 }}>
                    {lat.toFixed(4)}, {lon.toFixed(4)}
                  </div>
                  {ntsbNo ? (
                    <div style={{ fontSize: 13 }}>
                      NTSB: <b>{ntsbNo}</b>
                    </div>
                  ) : null}
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}
