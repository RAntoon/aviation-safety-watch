"use client";

import React, { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";

// Leaflet CSS must be imported in a client boundary somewhere.
import "leaflet/dist/leaflet.css";

// Dynamically import react-leaflet components to avoid SSR "window is not defined".
const MapContainer = dynamic(() => import("react-leaflet").then(m => m.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import("react-leaflet").then(m => m.TileLayer), { ssr: false });
const CircleMarker = dynamic(() => import("react-leaflet").then(m => m.CircleMarker), { ssr: false });
const Popup = dynamic(() => import("react-leaflet").then(m => m.Popup), { ssr: false });
const ZoomControl = dynamic(() => import("react-leaflet").then(m => m.ZoomControl), { ssr: false });

type UiItem = {
  id: string;
  lat: number;
  lon: number;
  title: string;
  eventType: "ACCIDENT" | "INCIDENT" | "UNKNOWN";
  fatalities: number;
  date: string; // YYYY-MM-DD
  cityState?: string;
  docketUrl?: string;
  raw?: any;
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

// Color rules you requested:
// - red: accidents with fatalities
// - orange: accidents without fatalities
// - yellow: incidents
function markerColor(it: UiItem) {
  if (it.eventType === "INCIDENT") return "#F2C94C"; // yellow
  if (it.eventType === "ACCIDENT" && it.fatalities > 0) return "#EB5757"; // red
  if (it.eventType === "ACCIDENT") return "#F2994A"; // orange
  return "#9B9B9B"; // unknown/other
}

export default function MapView() {
  const r = useMemo(() => last12MonthsRange(), []);
  const [start, setStart] = useState<string>(toYMD(r.start));
  const [end, setEnd] = useState<string>(toYMD(r.end));
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [items, setItems] = useState<UiItem[]>([]);
  const [counts, setCounts] = useState({ fatalAcc: 0, acc: 0, inc: 0 });

  async function load() {
    setLoading(true);
    setStatus("Loading…");

    const url = new URL("/api/ntsb", window.location.origin);
    url.searchParams.set("start", start);
    url.searchParams.set("end", end);

    // Safe toggle: allow mock dots if NTSB is down
    if (new URLSearchParams(window.location.search).get("mock") === "1") {
      url.searchParams.set("mock", "1");
    }

    try {
      const res = await fetch(url.toString());
      const json = await res.json();

      if (!res.ok || !json?.ok) {
        setItems([]);
        setCounts({ fatalAcc: 0, acc: 0, inc: 0 });

        // show a short error but keep app alive
        setStatus(
          `NTSB fetch not OK (${res.status}). Open /api/ntsb?start=${start}&end=${end}&debug=1 to see upstreamError.`
        );
        return;
      }

      const data: UiItem[] = (json.items || []) as UiItem[];
      setItems(data);

      let fatalAcc = 0, acc = 0, inc = 0;
      for (const it of data) {
        if (it.eventType === "INCIDENT") inc++;
        else if (it.eventType === "ACCIDENT" && it.fatalities > 0) fatalAcc++;
        else if (it.eventType === "ACCIDENT") acc++;
      }
      setCounts({ fatalAcc, acc, inc });

      setStatus(`OK · ${data.length} plotted`);
    } catch (e: any) {
      setItems([]);
      setCounts({ fatalAcc: 0, acc: 0, inc: 0 });
      setStatus(`Client error: ${String(e?.message || e)}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Continental US initial view
  const center: [number, number] = [39.5, -98.35];

  return (
    <div style={{ height: "100vh", width: "100vw", position: "relative" }}>
      {/* Panel */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 1000,
          background: "rgba(255,255,255,0.92)",
          borderRadius: 12,
          padding: 14,
          width: 360,
          boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
          backdropFilter: "blur(6px)",
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 18 }}>Aviation Safety Watch (MVP)</div>
        <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>
          Data source: NTSB endpoint · Default range: last 12 months
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700 }}>Start</div>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700 }}>End</div>
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              style={{ width: "100%" }}
            />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
          <button
            onClick={load}
            disabled={loading}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid rgba(0,0,0,0.15)",
              background: "white",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            {loading ? "Loading…" : "Reload"}
          </button>
          <div style={{ fontSize: 13, fontWeight: 700 }}>
            Dots shown: {items.length}
          </div>
        </div>

        <div style={{ marginTop: 10, fontWeight: 800 }}>Legend</div>
        <div style={{ marginTop: 6, fontSize: 13, display: "grid", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 14, height: 14, borderRadius: 14, background: "#EB5757", display: "inline-block" }} />
            Fatal accidents (red): {counts.fatalAcc}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 14, height: 14, borderRadius: 14, background: "#F2994A", display: "inline-block" }} />
            Accidents (orange): {counts.acc}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 14, height: 14, borderRadius: 14, background: "#F2C94C", display: "inline-block" }} />
            Incidents (yellow): {counts.inc}
          </div>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, color: status.includes("OK") ? "#2F855A" : "#C53030" }}>
          Status: {status}
        </div>
      </div>

      {/* Map */}
      <MapContainer
        // If TS yells in your environment, do NOT fight it mid-flight.
        // This is correct usage for react-leaflet.
        center={center as any}
        zoom={4 as any}
        scrollWheelZoom={true as any}
        zoomControl={false as any}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* zoom buttons bottom-right */}
        <ZoomControl position="bottomright" />

        {items.map((it) => (
          <CircleMarker
            key={it.id}
            center={[it.lat, it.lon] as any}
            radius={7}
            pathOptions={{ color: markerColor(it), fillColor: markerColor(it), fillOpacity: 0.85 }}
          >
            <Popup>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>{it.title || "NTSB Case"}</div>
              <div style={{ fontSize: 13 }}>
                <div><b>Date:</b> {it.date}</div>
                <div><b>Type:</b> {it.eventType}</div>
                <div><b>Fatalities:</b> {it.fatalities}</div>
                {it.cityState ? <div><b>Location:</b> {it.cityState}</div> : null}
              </div>
              {it.docketUrl ? (
                <div style={{ marginTop: 8 }}>
                  <a href={it.docketUrl} target="_blank" rel="noreferrer">
                    Open NTSB docket
                  </a>
                </div>
              ) : null}
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
