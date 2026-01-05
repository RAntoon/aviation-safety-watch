"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";

// Leaflet CSS (must load on client somewhere)
import "leaflet/dist/leaflet.css";

const MapContainer = dynamic(
  () => import("react-leaflet").then((m) => m.MapContainer),
  { ssr: false }
);
const TileLayer = dynamic(() => import("react-leaflet").then((m) => m.TileLayer), {
  ssr: false,
});
const CircleMarker = dynamic(
  () => import("react-leaflet").then((m) => m.CircleMarker),
  { ssr: false }
);
const Popup = dynamic(() => import("react-leaflet").then((m) => m.Popup), {
  ssr: false,
});
const ZoomControl = dynamic(
  () => import("react-leaflet").then((m) => m.ZoomControl),
  { ssr: false }
);

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

// Try to pull a usable lat/lng out of unknown NTSB shapes
function extractLatLng(row: any): { lat: number; lng: number } | null {
  const candidates = [
    { lat: row?.latitude, lng: row?.longitude },
    { lat: row?.Latitude, lng: row?.Longitude },
    { lat: row?.eventLatitude, lng: row?.eventLongitude },
    { lat: row?.EventLatitude, lng: row?.EventLongitude },
    { lat: row?.Lat, lng: row?.Lon },
    { lat: row?.Lat, lng: row?.Lng },
    { lat: row?.lat, lng: row?.lng },
  ];

  for (const c of candidates) {
    const lat = Number(c.lat);
    const lng = Number(c.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng };
    }
  }
  return null;
}

function extractId(row: any): string {
  return (
    row?.ntsbNumber ||
    row?.NtsbNumber ||
    row?.caseNumber ||
    row?.CaseNumber ||
    row?.mkey ||
    row?.Mkey ||
    row?.MKey ||
    row?.EventId ||
    row?.eventId ||
    `${Math.random()}`
  ).toString();
}

export default function MapView() {
  const defaults = useMemo(() => {
    const r = last12MonthsRange();
    return { start: toYMD(r.start), end: toYMD(r.end) };
  }, []);

  const [start, setStart] = useState<string>(defaults.start);
  const [end, setEnd] = useState<string>(defaults.end);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [dots, setDots] = useState<
    { id: string; lat: number; lng: number; title: string; raw: any }[]
  >([]);

  async function load(s = start, e = end) {
    setLoading(true);
    setStatus("");
    setDots([]);

    try {
      const res = await fetch(`/api/ntsb?start=${encodeURIComponent(s)}&end=${encodeURIComponent(e)}`, {
        cache: "no-store",
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setStatus(
          `NTSB fetch failed (${res.status}). ` +
            `Open /api/ntsb in your browser for details.`
        );
        setLoading(false);
        return;
      }

      const data = json.data;

      // NTSB may return array or object; try common shapes
      const rows: any[] =
        Array.isArray(data) ? data :
        Array.isArray(data?.cases) ? data.cases :
        Array.isArray(data?.Cases) ? data.Cases :
        Array.isArray(data?.data) ? data.data :
        [];

      const mapped = rows
        .map((row) => {
          const ll = extractLatLng(row);
          if (!ll) return null;

          const id = extractId(row);
          const title =
            row?.airport ||
            row?.Airport ||
            row?.city ||
            row?.City ||
            row?.location ||
            row?.Location ||
            row?.NtsbNumber ||
            row?.ntsbNumber ||
            "NTSB case";

          return { id, lat: ll.lat, lng: ll.lng, title: String(title), raw: row };
        })
        .filter(Boolean) as { id: string; lat: number; lng: number; title: string; raw: any }[];

      setDots(mapped);
      setStatus(`OK. Source: ${json.source}.`);
    } catch (e: any) {
      setStatus(`Client fetch error: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  // Load default range on first paint
  useEffect(() => {
    load(defaults.start, defaults.end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const center: [number, number] = [39.5, -98.35]; // continental US

  return (
    <div style={{ height: "100vh", width: "100%", position: "relative" }}>
      {/* Search / Controls Panel (top-right) */}
      <div
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          zIndex: 9999,
          background: "rgba(255,255,255,0.95)",
          borderRadius: 12,
          padding: 12,
          width: 320,
          boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
          fontSize: 13,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>
          Aviation Safety Watch (MVP)
        </div>
        <div style={{ color: "#444", marginBottom: 10 }}>
          Data source: NTSB Public API · Default range: last 12 months
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, marginBottom: 4 }}>Start</div>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, marginBottom: 4 }}>End</div>
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            onClick={() => load()}
            disabled={loading}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: loading ? "#f3f3f3" : "#fff",
              cursor: loading ? "not-allowed" : "pointer",
              fontWeight: 600,
            }}
          >
            {loading ? "Loading…" : "Reload"}
          </button>
          <div style={{ color: "#333" }}>
            Dots shown: <b>{dots.length}</b>
          </div>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, color: status.startsWith("OK") ? "#1b5e20" : "#8a1f11" }}>
          Status: {status || "—"}
        </div>
      </div>

      {/* Map */}
      <MapContainer
        center={center}
        zoom={4}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
        zoomControl={false} // we'll place it where we want
      >
        {/* Put zoom buttons top-left (separated from the panel which is top-right) */}
        <ZoomControl position="topleft" />

        <TileLayer
          // NOTE: react-leaflet v4 does NOT want the attribution prop in TS in some setups
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {dots.map((d) => (
          <CircleMarker
            key={d.id}
            center={[d.lat, d.lng]}
            radius={6}
            pathOptions={{}}
          >
            <Popup>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{d.title}</div>
              <div style={{ fontSize: 12, opacity: 0.85 }}>
                Lat/Lng: {d.lat.toFixed(4)}, {d.lng.toFixed(4)}
              </div>
              <div style={{ fontSize: 12, marginTop: 8 }}>
                <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>
{JSON.stringify(d.raw, null, 2).slice(0, 1500)}
                </pre>
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
