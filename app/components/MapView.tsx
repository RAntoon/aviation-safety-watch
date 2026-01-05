// @ts-nocheck
"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
  ZoomControl,
} from "react-leaflet";

type NtsbPoint = {
  id: string;
  lat: number;
  lon: number;
  label: string;
  eventDate?: string;
  city?: string;
  state?: string;
  country?: string;
  fatalities?: number;
  eventType?: "ACCIDENT" | "INCIDENT" | string;
  docketUrl?: string | null;
  ntsbNumber?: string | null;
};

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

function colorFor(p: NtsbPoint) {
  const isIncident =
    String(p.eventType || "").toUpperCase() === "INCIDENT" ||
    String(p.eventType || "").toUpperCase().includes("INCIDENT");

  if (isIncident) return "#f5c542"; // yellow
  const fat = Number(p.fatalities || 0);
  if (fat > 0) return "#d83a3a"; // red
  return "#f08a24"; // orange
}

export default function MapView() {
  const { start, end } = useMemo(() => last12MonthsRange(), []);
  const [startYmd, setStartYmd] = useState<string>(toYMD(start));
  const [endYmd, setEndYmd] = useState<string>(toYMD(end));

  const [status, setStatus] = useState<string>("Idle");
  const [points, setPoints] = useState<NtsbPoint[]>([]);
  const [counts, setCounts] = useState({
    fatalAccidents: 0,
    nonFatalAccidents: 0,
    incidents: 0,
  });

  async function load() {
    setStatus("Loading…");
    setPoints([]);
    setCounts({ fatalAccidents: 0, nonFatalAccidents: 0, incidents: 0 });

    try {
      const url = `/api/ntsb?start=${encodeURIComponent(
        startYmd
      )}&end=${encodeURIComponent(endYmd)}`;

      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();

      if (!res.ok || !json?.ok) {
        setStatus(
          `NTSB fetch failed (${res.status}). Check /api/ntsb response in Vercel logs.`
        );
        return;
      }

      const pts: NtsbPoint[] = json.points || [];
      setPoints(pts);

      let fatalAccidents = 0;
      let nonFatalAccidents = 0;
      let incidents = 0;

      for (const p of pts) {
        const isIncident =
          String(p.eventType || "").toUpperCase() === "INCIDENT" ||
          String(p.eventType || "").toUpperCase().includes("INCIDENT");
        if (isIncident) incidents += 1;
        else if (Number(p.fatalities || 0) > 0) fatalAccidents += 1;
        else nonFatalAccidents += 1;
      }

      setCounts({ fatalAccidents, nonFatalAccidents, incidents });

      const note = json?.geocodeNote ? ` (${json.geocodeNote})` : "";
      setStatus(`OK: ${pts.length} points${note}`);
    } catch (e: any) {
      setStatus(`Client error: ${String(e?.message || e)}`);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ position: "relative", height: "100%", width: "100%" }}>
      {/* Search / Controls panel */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 1000,
          width: 360,
          background: "rgba(255,255,255,0.95)",
          borderRadius: 10,
          padding: 12,
          boxShadow: "0 8px 30px rgba(0,0,0,0.15)",
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji"',
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700 }}>
          Aviation Safety Watch (MVP)
        </div>
        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
          Data source: NTSB Public API · Default range: last 12 months
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>Start</div>
            <input
              type="date"
              value={startYmd}
              onChange={(e) => setStartYmd(e.target.value)}
              style={{
                width: "100%",
                padding: "6px 8px",
                borderRadius: 8,
                border: "1px solid #ddd",
              }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>End</div>
            <input
              type="date"
              value={endYmd}
              onChange={(e) => setEndYmd(e.target.value)}
              style={{
                width: "100%",
                padding: "6px 8px",
                borderRadius: 8,
                border: "1px solid #ddd",
              }}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button
            onClick={load}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #ddd",
              background: "#fff",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Reload
          </button>
          <div style={{ alignSelf: "center", fontSize: 13 }}>
            Dots shown: <b>{points.length}</b>
          </div>
        </div>

        <div style={{ marginTop: 10, fontSize: 13 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Legend</div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                background: "#d83a3a",
                display: "inline-block",
              }}
            />
            <span>
              Fatal accidents (red): <b>{counts.fatalAccidents}</b>
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                background: "#f08a24",
                display: "inline-block",
              }}
            />
            <span>
              Accidents (orange): <b>{counts.nonFatalAccidents}</b>
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                background: "#f5c542",
                display: "inline-block",
              }}
            />
            <span>
              Incidents (yellow): <b>{counts.incidents}</b>
            </span>
          </div>
        </div>

        <div style={{ marginTop: 10, fontSize: 12 }}>
          <b>Status:</b> {status}
        </div>
      </div>

      {/* Map */}
      <MapContainer
        center={[39.5, -98.35]}
        zoom={4}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom
        zoomControl={false}
      >
        {/* Separate zoom controls from the top-left panel */}
        <ZoomControl position="bottomright" />

        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {points.map((p) => (
          <CircleMarker
            key={p.id}
            center={[p.lat, p.lon]}
            radius={6}
            pathOptions={{
              color: colorFor(p),
              fillColor: colorFor(p),
              fillOpacity: 0.85,
              weight: 1,
            }}
          >
            <Popup>
              <div style={{ minWidth: 220 }}>
                <div style={{ fontWeight: 800 }}>{p.label}</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  {p.eventDate ? <div>Date: {p.eventDate}</div> : null}
                  {p.city || p.state || p.country ? (
                    <div>
                      Location: {[p.city, p.state, p.country]
                        .filter(Boolean)
                        .join(", ")}
                    </div>
                  ) : null}
                  <div>Type: {p.eventType || "—"}</div>
                  <div>Fatalities: {Number(p.fatalities || 0)}</div>
                </div>

                {p.docketUrl ? (
                  <div style={{ marginTop: 8 }}>
                    <a href={p.docketUrl} target="_blank" rel="noreferrer">
                      Open NTSB docket
                    </a>
                  </div>
                ) : null}

                {p.ntsbNumber ? (
                  <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>
                    NTSB #: {p.ntsbNumber}
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
