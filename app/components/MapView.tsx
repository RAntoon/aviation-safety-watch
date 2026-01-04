"use client";

import React, { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";

type Airport = {
  iata: string; // display code
  icao: string; // FAA fetch code (ASWS expects ICAO)
  name: string;
  lat: number;
  lon: number;
};

type AirportStatus = {
  iata: string;
  icao: string;
  name?: string;
  status: "normal" | "delay" | "ground_stop" | "unknown";
  raw?: {
    delay?: boolean;
    reason?: string;
    avgDelay?: string;
    trend?: string;
    endTime?: string;
    lastUpdate?: string;
  };
  note?: string;
};

const AIRPORTS: Airport[] = [
  { iata: "LAX", icao: "KLAX", name: "Los Angeles Intl", lat: 33.9416, lon: -118.4085 },
  { iata: "SFO", icao: "KSFO", name: "San Francisco Intl", lat: 37.6213, lon: -122.379 },
  { iata: "JFK", icao: "KJFK", name: "John F. Kennedy Intl", lat: 40.6413, lon: -73.7781 },
  { iata: "ORD", icao: "KORD", name: "Chicago O'Hare Intl", lat: 41.9742, lon: -87.9073 },
];

function statusToLabel(s: AirportStatus["status"]) {
  if (s === "delay") return "DELAY";
  if (s === "ground_stop") return "GROUND STOP";
  if (s === "normal") return "NORMAL";
  return "UNKNOWN";
}

function statusToMarkerStyle(s: AirportStatus["status"]) {
  // Keep it simple + readable
  if (s === "delay") return { radius: 9, weight: 2, fillOpacity: 0.6 };
  if (s === "ground_stop") return { radius: 10, weight: 2, fillOpacity: 0.6 };
  if (s === "normal") return { radius: 8, weight: 2, fillOpacity: 0.4 };
  return { radius: 8, weight: 2, fillOpacity: 0.35 };
}

export default function MapView() {
  const center: LatLngExpression = useMemo(() => [39.5, -98.35], []);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string>("");
  const [statuses, setStatuses] = useState<Record<string, AirportStatus>>({});

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const res = await fetch("/api/airports", { cache: "no-store" });
        const data = await res.json();

        if (cancelled) return;

        const map: Record<string, AirportStatus> = {};
        for (const s of (data.statuses ?? []) as AirportStatus[]) {
          map[s.iata] = s;
        }

        setStatuses(map);
        setUpdatedAt(data.updatedAt ?? new Date().toISOString());
      } catch (e: any) {
        if (cancelled) return;
        setUpdatedAt(new Date().toISOString());
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const t = setInterval(load, 60_000); // refresh every 60s
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return (
    <div style={{ height: "100vh", width: "100vw" }}>
      <div
        style={{
          position: "absolute",
          zIndex: 1000,
          left: 12,
          top: 12,
          background: "white",
          padding: 10,
          borderRadius: 8,
          boxShadow: "0 2px 12px rgba(0,0,0,0.12)",
          fontSize: 14,
          lineHeight: 1.35,
          maxWidth: 320,
        }}
      >
        <div style={{ fontWeight: 700 }}>Aviation Safety Watch (MVP)</div>
        <div>Airports plotted: {AIRPORTS.length}</div>
        <div>FAA status source: ASWS airport status</div>
        <div>Updated: {new Date(updatedAt).toLocaleString()}</div>
        {loading ? <div style={{ marginTop: 6 }}>Loading…</div> : null}
      </div>

      <MapContainer center={center} zoom={4} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {AIRPORTS.map((a) => {
          const s = statuses[a.iata] ?? {
            iata: a.iata,
            icao: a.icao,
            status: "unknown",
            note: "No status returned yet",
          };

          const marker = statusToMarkerStyle(s.status);

          return (
            <CircleMarker
              key={a.iata}
              center={[a.lat, a.lon]}
              pathOptions={{}}
              radius={marker.radius}
              weight={marker.weight}
              fillOpacity={marker.fillOpacity}
            >
              <Popup>
                <div style={{ minWidth: 220 }}>
                  <div style={{ fontWeight: 700 }}>
                    {a.iata} — {a.name}
                  </div>
                  <div>Status: {statusToLabel(s.status)}</div>
                  <div style={{ marginTop: 6, fontSize: 13, opacity: 0.9 }}>
                    <div>Source: FAA ASWS</div>
                    <div>ICAO: {a.icao}</div>
                    {s.raw?.reason ? <div>Reason: {s.raw.reason}</div> : null}
                    {s.raw?.avgDelay ? <div>Avg delay: {s.raw.avgDelay}</div> : null}
                    {s.raw?.trend ? <div>Trend: {s.raw.trend}</div> : null}
                    {s.raw?.endTime ? <div>End: {s.raw.endTime}</div> : null}
                    {s.raw?.lastUpdate ? <div>FAA updated: {s.raw.lastUpdate}</div> : null}
                    {s.note ? <div style={{ marginTop: 6 }}>Note: {s.note}</div> : null}
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}
