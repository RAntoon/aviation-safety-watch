"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  ZoomControl,
} from "react-leaflet";
import type { LatLngExpression } from "leaflet";

type NtsbPoint = {
  id: string;
  lat: number;
  lng: number;
  title?: string;
  eventDate?: string;
  city?: string;
  state?: string;
  fatalities?: number;
  eventType?: "ACCIDENT" | "INCIDENT" | string;
  docketUrl?: string;
};

function isoDate(d: Date) {
  // YYYY-MM-DD
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function MapView() {
  const today = useMemo(() => new Date(), []);
  const defaultEnd = useMemo(() => isoDate(today), [today]);
  const defaultStart = useMemo(() => {
    const d = new Date(today);
    d.setFullYear(d.getFullYear() - 1);
    return isoDate(d);
  }, [today]);

  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);

  const [status, setStatus] = useState<string>("Ready.");
  const [points, setPoints] = useState<NtsbPoint[]>([]);

  const center: LatLngExpression = [39.5, -98.35]; // continental US

  async function load() {
    setStatus("Loading…");
    try {
      const res = await fetch(`/api/ntsb?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, {
        cache: "no-store",
      });

      const json = await res.json();

      if (!res.ok) {
        setPoints([]);
        setStatus(`NTSB fetch not OK (${res.status}). Open /api/ntsb to see details.`);
        return;
      }

      const data: NtsbPoint[] = Array.isArray(json?.points) ? json.points : [];
      setPoints(data);

      if (json?.upstreamError) {
        setStatus(`Upstream warning: ${json.upstreamError}`);
      } else {
        setStatus(`Loaded ${data.length} items.`);
      }
    } catch (e: any) {
      setPoints([]);
      setStatus(`Fetch error: ${e?.message ?? String(e)}`);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => {
    let fatalAcc = 0;
    let nonfatalAcc = 0;
    let incidents = 0;

    for (const p of points) {
      const isIncident = (p.eventType ?? "").toUpperCase() === "INCIDENT";
      const fat = Number(p.fatalities ?? 0);

      if (isIncident) incidents += 1;
      else if (fat > 0) fatalAcc += 1;
      else nonfatalAcc += 1;
    }

    return { fatalAcc, nonfatalAcc, incidents };
  }, [points]);

  function markerStyle(p: NtsbPoint) {
    const isIncident = (p.eventType ?? "").toUpperCase() === "INCIDENT";
    const fat = Number(p.fatalities ?? 0);

    // requested colors:
    // red = accidents w fatalities
    // orange = accidents w/o fatalities
    // yellow = incidents
    if (isIncident) return { color: "#f2c200", fillColor: "#f2c200" }; // yellow
    if (fat > 0) return { color: "#d93025", fillColor: "#d93025" }; // red
    return { color: "#f57c00", fillColor: "#f57c00" }; // orange
  }

  return (
    <div style={{ height: "100vh", width: "100vw" }}>
      <MapContainer
        center={center}
        zoom={4}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
        zoomControl={false} // ✅ disable default (top-left)
      >
        {/* ✅ place zoom in bottom-right */}
        <ZoomControl position="bottomright" />

        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {points.map((p) => (
          <CircleMarker
            key={p.id}
            center={[p.lat, p.lng]}
            radius={7}
            pathOptions={{ ...markerStyle(p), fillOpacity: 0.85, weight: 2 }}
          >
            <Popup>
              <div style={{ minWidth: 220 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>
                  {p.title ?? "NTSB Case"}
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.35 }}>
                  <div>
                    <b>Date:</b> {p.eventDate ?? "—"}
                  </div>
                  <div>
                    <b>Location:</b> {[p.city, p.state].filter(Boolean).join(", ") || "—"}
                  </div>
                  <div>
                    <b>Type:</b> {p.eventType ?? "—"}
                  </div>
                  <div>
                    <b>Fatalities:</b> {String(p.fatalities ?? 0)}
                  </div>
                  {p.docketUrl ? (
                    <div style={{ marginTop: 8 }}>
                      <a href={p.docketUrl} target="_blank" rel="noreferrer">
                        Open NTSB docket
                      </a>
                    </div>
                  ) : null}
                </div>
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>

      {/* overlay panel */}
      <div
        style={{
          position: "absolute",
          top: 14,
          left: 14,
          zIndex: 999,
          width: 360,
          background: "rgba(255,255,255,0.95)",
          borderRadius: 12,
          padding: 14,
          boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>
          Aviation Safety Watch (MVP)
        </div>
        <div style={{ fontSize: 12, color: "#444", marginBottom: 10 }}>
          Data source: NTSB endpoint · Default range: last 12 months
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Start</div>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>End</div>
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
          <button
            onClick={load}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: "#fff",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            Reload
          </button>
          <div style={{ fontSize: 13 }}>
            Dots shown: <b>{points.length}</b>
          </div>
        </div>

        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>Legend</div>
        <div style={{ fontSize: 13, lineHeight: 1.5 }}>
          <div>
            <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 10, background: "#d93025", marginRight: 8 }} />
            Fatal accidents (red): <b>{counts.fatalAcc}</b>
          </div>
          <div>
            <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 10, background: "#f57c00", marginRight: 8 }} />
            Accidents (orange): <b>{counts.nonfatalAcc}</b>
          </div>
          <div>
            <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 10, background: "#f2c200", marginRight: 8 }} />
            Incidents (yellow): <b>{counts.incidents}</b>
          </div>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, color: status.includes("not OK") ? "#b00020" : "#333" }}>
          <b>Status:</b> {status}
        </div>
      </div>
    </div>
  );
}
