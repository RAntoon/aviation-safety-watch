// @ts-nocheck
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";

type CasePoint = {
  id: string;
  lat: number;
  lon: number;
  title: string;
  date?: string;
  url?: string;
};

const MapContainerAny = MapContainer as any;
const TileLayerAny = TileLayer as any;
const CircleMarkerAny = CircleMarker as any;
const PopupAny = Popup as any;

export default function MapView() {
  // Center on continental US
  const center = useMemo(() => [39.5, -98.35] as [number, number], []);
  const [points, setPoints] = useState<CasePoint[]>([]);
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    // MVP: just prove the map renders and the app builds.
    // We'll wire this to your /api/ntsb route next.
    setStatus("Map loaded. (Next step: connect NTSB API route)");
    setPoints([
      {
        id: "demo-lax",
        lat: 33.9416,
        lon: -118.4085,
        title: "Demo marker (will be replaced by NTSB data)",
      },
    ]);
  }, []);

  return (
    <div style={{ height: "100vh", width: "100vw" }}>
      {/* Simple overlay */}
      <div
        style={{
          position: "absolute",
          zIndex: 1000,
          left: 12,
          top: 12,
          background: "white",
          padding: 10,
          borderRadius: 10,
          boxShadow: "0 2px 12px rgba(0,0,0,0.12)",
          maxWidth: 360,
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
        }}
      >
        <div style={{ fontWeight: 700 }}>Aviation Safety Watch (MVP)</div>
        <div style={{ fontSize: 13, opacity: 0.85 }}>{status}</div>
        <div style={{ fontSize: 12, opacity: 0.7 }}>
          Points plotted: {points.length}
        </div>
      </div>

      <MapContainerAny
        center={center}
        zoom={4}
        scrollWheelZoom={true}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayerAny
          // attribution is fine here; TS was the thing complaining
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {points.map((p) => (
          <CircleMarkerAny
            key={p.id}
            center={[p.lat, p.lon]}
            radius={7}
            pathOptions={{ weight: 2 }}
          >
            <PopupAny>
              <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial" }}>
                <div style={{ fontWeight: 700 }}>{p.title}</div>
                {p.date ? <div>Date: {p.date}</div> : null}
                {p.url ? (
                  <div style={{ marginTop: 6 }}>
                    <a href={p.url} target="_blank" rel="noreferrer">
                      Open case
                    </a>
                  </div>
                ) : null}
              </div>
            </PopupAny>
          </CircleMarkerAny>
        ))}
      </MapContainerAny>
    </div>
  );
}
