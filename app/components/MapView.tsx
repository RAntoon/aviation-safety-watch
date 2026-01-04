// @ts-nocheck
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

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

// Fix default marker icon paths (common Next/Vercel issue)
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png"
});

type Dot = {
  id: string;
  lat: number;
  lon: number;
  title: string;
  date?: string;
  location?: string;
  ntsbNumber?: string;
};

function pickLatLon(item: any): { lat: number; lon: number } | null {
  const lat =
    item?.latitude ??
    item?.Latitude ??
    item?.lat ??
    item?.Lat ??
    item?.Location?.Latitude ??
    item?.location?.latitude ??
    item?.Geo?.Latitude;

  const lon =
    item?.longitude ??
    item?.Longitude ??
    item?.lon ??
    item?.Lon ??
    item?.Location?.Longitude ??
    item?.location?.longitude ??
    item?.Geo?.Longitude ??
    item?.lng ??
    item?.Lng;

  const latNum = Number(lat);
  const lonNum = Number(lon);

  if (Number.isFinite(latNum) && Number.isFinite(lonNum)) return { lat: latNum, lon: lonNum };
  return null;
}

function pickNtsbNumber(item: any): string | undefined {
  return (
    item?.ntsbNumber ??
    item?.NtsbNumber ??
    item?.NTSBNumber ??
    item?.CaseNumber ??
    item?.caseNumber ??
    item?.InvestigationNumber ??
    item?.investigationNumber ??
    item?.NtsbNo
  );
}

function pickDate(item: any): string | undefined {
  return (
    item?.eventDate ??
    item?.EventDate ??
    item?.AccidentDate ??
    item?.accidentDate ??
    item?.OccurrenceDate ??
    item?.occurrenceDate ??
    item?.Date
  );
}

function pickTitle(item: any): string {
  return (
    item?.title ??
    item?.Title ??
    item?.EventType ??
    item?.eventType ??
    item?.AircraftCategory ??
    item?.aircraftCategory ??
    "Aviation case"
  );
}

function pickLocation(item: any): string | undefined {
  const city = item?.city ?? item?.City;
  const state = item?.state ?? item?.State;
  const country = item?.country ?? item?.Country;

  const parts = [city, state, country].filter(Boolean);
  if (parts.length) return parts.join(", ");

  return item?.location ?? item?.LocationName ?? item?.Location ?? undefined;
}

function flattenCases(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;

  // Common patterns: { data: [...] } or { Results: [...] } etc.
  const candidates = [
    payload?.data,
    payload?.Data,
    payload?.results,
    payload?.Results,
    payload?.cases,
    payload?.Cases,
    payload?.items,
    payload?.Items
  ];

  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }

  // Sometimes nested like { data: { results: [...] } }
  for (const c of candidates) {
    if (c && typeof c === "object") {
      const inner = flattenCases(c);
      if (inner.length) return inner;
    }
  }

  return [];
}

export default function MapView() {
  const { startDefault, endDefault } = useMemo(() => {
    const r = last12MonthsRange();
    return { startDefault: toYMD(r.start), endDefault: toYMD(r.end) };
  }, []);

  const [start, setStart] = useState(startDefault);
  const [end, setEnd] = useState(endDefault);
  const [dots, setDots] = useState<Dot[]>([]);
  const [status, setStatus] = useState<string>("Ready");
  const [fetchedAt, setFetchedAt] = useState<string>("");

  async function load() {
    setStatus("Loading...");
    setDots([]);

    try {
      const res = await fetch(`/api/ntsb?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, {
        cache: "no-store"
      });
      const json = await res.json();

      if (!res.ok || !json?.ok) {
        setStatus(`NTSB fetch failed (${res.status}). Check server response in /api/ntsb.`);
        return;
      }

      const items = flattenCases(json.data);
      const mapped: Dot[] = [];

      for (const item of items) {
        const ll = pickLatLon(item);
        if (!ll) continue;

        const ntsbNumber = pickNtsbNumber(item);
        mapped.push({
          id: String(ntsbNumber ?? item?.mkey ?? item?.MKey ?? item?.id ?? Math.random()),
          lat: ll.lat,
          lon: ll.lon,
          title: pickTitle(item),
          date: pickDate(item),
          location: pickLocation(item),
          ntsbNumber
        });
      }

      setDots(mapped);
      setFetchedAt(json.fetchedAt || "");
      setStatus(`OK (showing ${mapped.length} dots)`);
    } catch (e: any) {
      setStatus(`Client error: ${String(e?.message || e)}`);
    }
  }

  // Auto-load on first render (default: last 12 months)
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const centerUS: [number, number] = [39.5, -98.35];

  return (
    <div style={{ height: "100vh", width: "100%" }}>
      {/* Top-left control panel */}
      <div
        style={{
          position: "absolute",
          zIndex: 999,
          top: 12,
          left: 12,
          background: "rgba(255,255,255,0.95)",
          padding: 12,
          borderRadius: 10,
          width: 330,
          boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
          fontSize: 13
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
          Aviation Safety Watch (MVP)
        </div>
        <div style={{ opacity: 0.85, marginBottom: 8 }}>
          Data source: NTSB Public API · Default range: last 12 months
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
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

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            onClick={load}
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid #ddd",
              background: "#fff",
              cursor: "pointer",
              fontWeight: 600
            }}
          >
            Reload
          </button>
          <div style={{ opacity: 0.85 }}>
            Dots shown: <b>{dots.length}</b>
          </div>
        </div>

        <div style={{ marginTop: 8, lineHeight: 1.3 }}>
          <div>Status: <b>{status}</b></div>
          {fetchedAt ? <div>Updated: {new Date(fetchedAt).toLocaleString()}</div> : null}
        </div>
      </div>

      {/* Map */}
      <MapContainer center={centerUS} zoom={4} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {dots.map((d) => (
          <CircleMarker
            key={d.id}
            center={[d.lat, d.lon]}
            radius={6}
            pathOptions={{ weight: 2, fillOpacity: 0.6 }}
          >
            <Popup>
              <div style={{ minWidth: 220 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{d.title}</div>
                {d.date ? <div><b>Date:</b> {String(d.date)}</div> : null}
                {d.location ? <div><b>Location:</b> {d.location}</div> : null}
                {d.ntsbNumber ? (
                  <div style={{ marginTop: 6 }}>
                    <b>NTSB #:</b> {d.ntsbNumber}
                    <div style={{ marginTop: 4 }}>
                      <a
                        href="https://data.ntsb.gov/Docket/forms/Searchdocket"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open NTSB docket search
                      </a>
                      <div style={{ opacity: 0.7, fontSize: 12 }}>
                        (Paste the NTSB # into the search)
                      </div>
                    </div>
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
