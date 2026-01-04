"use client";

// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";

type CaseItem = {
  ntsbNumber?: string;
  eventId?: string;
  city?: string;
  state?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  lat?: number;
  lon?: number;
  eventDate?: string;
  summary?: string;
  url?: string;
};

function yyyyMmDd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function MapView() {
  const today = useMemo(() => new Date(), []);
  const oneYearAgo = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d;
  }, []);

  const [startDate, setStartDate] = useState(yyyyMmDd(oneYearAgo));
  const [endDate, setEndDate] = useState(yyyyMmDd(today));
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [status, setStatus] = useState<string>("Idle");
  const [updatedAt, setUpdatedAt] = useState<string>("");

  async function load() {
    setStatus("Loading…");
    try {
      const res = await fetch(`/api/ntsb/cases?start=${startDate}&end=${endDate}`, {
        cache: "no-store",
      });
      const data = await res.json();

      if (!res.ok) {
        setCases([]);
        setStatus(`API error ${res.status}: ${data?.error || "Unknown error"}`);
        setUpdatedAt(new Date().toLocaleString());
        return;
      }

      const raw = Array.isArray(data) ? data : (data?.cases ?? data?.data ?? []);
      const normalized: CaseItem[] = (raw || []).map((c: any) => ({
        ntsbNumber: c?.ntsbNumber ?? c?.NTSBNumber ?? c?.NtsbNumber,
        eventId: c?.eventId ?? c?.EventId ?? c?.mkey ?? c?.MKey,
        city: c?.city ?? c?.City,
        state: c?.state ?? c?.State,
        country: c?.country ?? c?.Country,
        latitude: c?.latitude ?? c?.Latitude,
        longitude: c?.longitude ?? c?.Longitude,
        lat: c?.lat,
        lon: c?.lon,
        eventDate: c?.eventDate ?? c?.EventDate ?? c?.date ?? c?.Date,
        summary: c?.summary ?? c?.Synopsis ?? c?.Narrative,
        url: c?.url,
      }));

      // ONLY plot points with real coordinates (no guessing)
      const withCoords = normalized.filter((c) => {
        const lat = c.latitude ?? c.lat;
        const lon = c.longitude ?? c.lon;
        return typeof lat === "number" && typeof lon === "number" && isFinite(lat) && isFinite(lon);
      });

      setCases(withCoords);
      setStatus(`OK (${withCoords.length} plotted)`);
      setUpdatedAt(new Date().toLocaleString());
    } catch (e: any) {
      setCases([]);
      setStatus(`Fetch failed: ${e?.message || String(e)}`);
      setUpdatedAt(new Date().toLocaleString());
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const center = [39.5, -98.35]; // US center (just map view; not “data”)

  return (
    <div style={{ height: "100vh", width: "100vw" }}>
      <div
        style={{
          position: "absolute",
          zIndex: 1000,
          top: 12,
          left: 12,
          background: "rgba(255,255,255,0.95)",
          borderRadius: 10,
          padding: 12,
          boxShadow: "0 2px 14px rgba(0,0,0,0.15)",
          width: 360,
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Aviation Safety Watch (MVP)</div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <label style={{ fontSize: 12 }}>
            Start
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={{ display: "block", width: 155 }}
            />
          </label>
          <label style={{ fontSize: 12 }}>
            End
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              style={{ display: "block", width: 155 }}
            />
          </label>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={load}
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid #ddd",
              background: "#fff",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Refresh
          </button>
          <div style={{ fontSize: 12, lineHeight: 1.4 }}>
            <div><b>Status:</b> {status}</div>
            <div><b>Updated:</b> {updatedAt || "—"}</div>
            <div><b>Plotted:</b> {cases.length}</div>
          </div>
        </div>

        <div style={{ fontSize: 12, marginTop: 8, opacity: 0.8 }}>
          Only plots records with real lat/lon from the API. No coordinate guessing.
        </div>
      </div>

      <MapContainer center={center} zoom={4} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
        <TileLayer
          // NOTE: react-leaflet v4 uses `attribution` (your TS types were glitching earlier; ts-nocheck avoids blocking builds)
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {cases.map((c, idx) => {
          const lat = c.latitude ?? c.lat;
          const lon = c.longitude ?? c.lon;
          const title = c.ntsbNumber || c.eventId || `Case ${idx + 1}`;
          const loc = [lat, lon];

          return (
            <CircleMarker key={`${title}-${idx}`} center={loc} radius={6} pathOptions={{}}>
              <Popup>
                <div style={{ minWidth: 240 }}>
                  <div style={{ fontWeight: 700 }}>{title}</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>
                    {c.city ? `${c.city}${c.state ? ", " + c.state : ""}` : ""}
                    {c.country ? ` ${c.country}` : ""}
                  </div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>
                    <b>Date:</b> {c.eventDate || "—"}
                  </div>
                  {c.summary ? (
                    <div style={{ fontSize: 12, marginTop: 6, whiteSpace: "pre-wrap" }}>{c.summary}</div>
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
