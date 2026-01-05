"use client";

import React, { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import "leaflet/dist/leaflet.css";

// Dynamically import react-leaflet pieces (prevents “window is not defined”)
const MapContainer = dynamic(
  () => import("react-leaflet").then((m) => m.MapContainer),
  { ssr: false }
);
const TileLayer = dynamic(
  () => import("react-leaflet").then((m) => m.TileLayer),
  { ssr: false }
);
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

type MarkerKind = "fatal" | "accident" | "incident";

type MarkerPoint = {
  id: string;
  kind: MarkerKind;
  lat: number;
  lon: number;
  title: string;
  date?: string;
  locationText?: string;
  docketUrl?: string;
};

function ymd(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function defaultLast12Months() {
  const end = new Date();
  const start = new Date(end);
  start.setFullYear(end.getFullYear() - 1);
  return { start: ymd(start), end: ymd(end) };
}

// Color mapping (you asked for red/orange/yellow)
function colorFor(kind: MarkerKind) {
  if (kind === "fatal") return "#d32f2f"; // red
  if (kind === "accident") return "#f57c00"; // orange
  return "#fbc02d"; // yellow
}

// Very conservative “best effort” extractor until we confirm the exact NTSB schema
function extractMarkersFromRaw(raw: any): MarkerPoint[] {
  // Your route returns { raw: ... } where raw could be array or object
  const payload = raw;

  // Try common shapes:
  const cases: any[] =
    Array.isArray(payload) ? payload :
    Array.isArray(payload?.cases) ? payload.cases :
    Array.isArray(payload?.Cases) ? payload.Cases :
    Array.isArray(payload?.data) ? payload.data :
    [];

  const out: MarkerPoint[] = [];

  for (const c of cases) {
    // These field names may differ; we’ll adapt once we see the actual raw payload.
    const id =
      String(c?.caseNumber ?? c?.CaseNumber ?? c?.NtsbNumber ?? c?.ntsbNumber ?? c?.id ?? crypto.randomUUID());

    const title =
      String(
        c?.eventType ??
          c?.EventType ??
          c?.injurySeverity ??
          c?.InjurySeverity ??
          c?.aircraftMake ??
          c?.AircraftMake ??
          "NTSB case"
      );

    const date =
      String(c?.eventDate ?? c?.EventDate ?? c?.date ?? c?.Date ?? "").trim() || undefined;

    const locationText =
      String(
        c?.location ??
          c?.Location ??
          c?.city ??
          c?.City ??
          ""
      ).trim() || undefined;

    // Location: we need actual coordinates to place dots.
    // Try a bunch of common coordinate keys:
    const lat =
      c?.latitude ??
      c?.Latitude ??
      c?.lat ??
      c?.Lat ??
      c?.locationLat ??
      c?.LocationLat;

    const lon =
      c?.longitude ??
      c?.Longitude ??
      c?.lon ??
      c?.Lon ??
      c?.lng ??
      c?.Lng ??
      c?.locationLon ??
      c?.LocationLon;

    if (typeof lat !== "number" || typeof lon !== "number") {
      // No coordinates => cannot plot yet (we’ll fix via geocoding in the next step)
      continue;
    }

    // Determine kind (fatal/accident/incident)
    const fatalities =
      Number(c?.fatalities ?? c?.Fatalities ?? c?.totalFatalities ?? 0) || 0;

    const mode =
      String(c?.mode ?? c?.Mode ?? c?.investigationType ?? c?.InvestigationType ?? "").toLowerCase();

    // Best-effort classification:
    let kind: MarkerKind = "incident";
    if (fatalities > 0) kind = "fatal";
    else if (mode.includes("accident") || String(c?.eventClass ?? c?.EventClass ?? "").toLowerCase().includes("accident")) kind = "accident";
    else kind = "incident";

    const docketUrl =
      (c?.docketUrl ?? c?.DocketUrl ?? c?.ntsbUrl ?? c?.NtsbUrl ?? "").trim() || undefined;

    out.push({
      id,
      kind,
      lat,
      lon,
      title,
      date,
      locationText,
      docketUrl,
    });
  }

  return out;
}

export default function MapView() {
  const def = useMemo(() => defaultLast12Months(), []);
  const [start, setStart] = useState(def.start);
  const [end, setEnd] = useState(def.end);

  const [status, setStatus] = useState<string>("");
  const [markers, setMarkers] = useState<MarkerPoint[]>([]);

  const counts = useMemo(() => {
    const fatal = markers.filter((m) => m.kind === "fatal").length;
    const accident = markers.filter((m) => m.kind === "accident").length;
    const incident = markers.filter((m) => m.kind === "incident").length;
    return { fatal, accident, incident };
  }, [markers]);

  async function reload() {
    setStatus("Loading…");
    setMarkers([]);

    try {
      const res = await fetch(`/api/ntsb?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, {
        cache: "no-store",
      });
      const json = await res.json();

      if (!json?.ok) {
        setStatus(
          `NTSB fetch not OK. Open /api/ntsb in your browser to see upstreamError.`
        );
        return;
      }

      const pts = extractMarkersFromRaw(json.raw);
      setMarkers(pts);

      if (pts.length === 0) {
        setStatus(
          `No plottable points yet (likely missing lat/lon in payload). Next step: geocode server-side.`
        );
      } else {
        setStatus(`Loaded ${pts.length} points.`);
      }
    } catch (e: any) {
      setStatus(`Client fetch failed: ${String(e?.message ?? e)}`);
    }
  }

  return (
    <div style={{ position: "relative", height: "100vh", width: "100%" }}>
      {/* Control panel */}
      <div
        style={{
          position: "absolute",
          zIndex: 1000,
          top: 16,
          left: 64, // leaves room so it doesn't collide with zoom buttons
          width: 360,
          background: "rgba(255,255,255,0.95)",
          borderRadius: 12,
          boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
          padding: 14,
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
          Aviation Safety Watch (MVP)
        </div>
        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 10 }}>
          Data source: NTSB endpoint • Default range: last 12 months
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>Start</div>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              style={{ width: "100%" }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>End</div>
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              style={{ width: "100%" }}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}>
          <button
            onClick={reload}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid rgba(0,0,0,0.15)",
              background: "#fff",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Reload
          </button>
          <div style={{ fontSize: 12 }}>Dots shown: {markers.length}</div>
        </div>

        <div style={{ marginTop: 12, fontSize: 12, fontWeight: 700 }}>
          Legend
        </div>
        <div style={{ marginTop: 6, fontSize: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 12, height: 12, borderRadius: 999, background: colorFor("fatal"), display: "inline-block" }} />
            Fatal accidents (red): {counts.fatal}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            <span style={{ width: 12, height: 12, borderRadius: 999, background: colorFor("accident"), display: "inline-block" }} />
            Accidents (orange): {counts.accident}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            <span style={{ width: 12, height: 12, borderRadius: 999, background: colorFor("incident"), display: "inline-block" }} />
            Incidents (yellow): {counts.incident}
          </div>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, color: status.includes("Loaded") ? "green" : "crimson" }}>
          Status: {status || "—"}
        </div>
      </div>

      {/* Map */}
      <MapContainer
        center={[39.5, -98.35]} // continental US
        zoom={4}
        style={{ height: "100%", width: "100%" }}
        zoomControl={false} // we'll place it manually
      >
        <ZoomControl position="topleft" />
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {markers.map((m) => (
          <CircleMarker
            key={m.id}
            center={[m.lat, m.lon]}
            radius={6}
            pathOptions={{
              color: colorFor(m.kind),
              fillColor: colorFor(m.kind),
              fillOpacity: 0.85,
              weight: 2,
            }}
          >
            <Popup>
              <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial" }}>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>{m.title}</div>
                {m.date ? <div><b>Date:</b> {m.date}</div> : null}
                {m.locationText ? <div><b>Location:</b> {m.locationText}</div> : null}
                {m.docketUrl ? (
                  <div style={{ marginTop: 8 }}>
                    <a href={m.docketUrl} target="_blank" rel="noreferrer">
                      Open NTSB docket
                    </a>
                  </div>
                ) : (
                  <div style={{ marginTop: 8, opacity: 0.7 }}>
                    (No docket URL found in payload yet)
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
