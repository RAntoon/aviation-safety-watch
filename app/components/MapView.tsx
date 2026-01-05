// @ts-nocheck
"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
  ZoomControl,
} from "react-leaflet";
import { useMemo } from "react";

// Fix default Leaflet marker icon paths (only needed if you ever use <Marker> icons)
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

type SafetyDot = {
  id: string;
  lat: number;
  lng: number;
  label: string;
  date?: string;
  city?: string;
  state?: string;
  country?: string;
  isAccident?: boolean;
  fatalCount?: number;
  url?: string;
  raw?: any;
};

function pickColor(dot: SafetyDot) {
  const fatal = Number(dot.fatalCount ?? 0) > 0;
  const isAccident = !!dot.isAccident;

  if (isAccident && fatal) return "#d32f2f"; // red
  if (isAccident && !fatal) return "#f57c00"; // orange
  return "#fbc02d"; // yellow (incidents)
}

export default function MapView({ dots }: { dots: SafetyDot[] }) {
  const usCenter: [number, number] = [39.5, -98.35];

  // keep stable references
  const safeDots = useMemo(() => dots ?? [], [dots]);

  return (
    <div style={{ height: "100vh", width: "100vw" }}>
      <MapContainer
        center={usCenter}
        zoom={4}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
        zoomControl={false} // disable default so we can place it manually
      >
        {/* ✅ Put zoom buttons back in the bottom-right */}
        <ZoomControl position="bottomright" />

        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {safeDots.map((d) => (
          <CircleMarker
            key={d.id}
            center={[d.lat, d.lng]}
            radius={6}
            pathOptions={{
              color: pickColor(d),
              weight: 2,
              fillOpacity: 0.8,
            }}
          >
            <Popup>
              <div style={{ minWidth: 220 }}>
                <div style={{ fontWeight: 700 }}>{d.label}</div>
                {d.date && <div>Date: {d.date}</div>}
                <div>
                  Location: {[d.city, d.state, d.country].filter(Boolean).join(", ")}
                </div>
                <div>
                  Type:{" "}
                  {d.isAccident
                    ? d.fatalCount && d.fatalCount > 0
                      ? "Accident (fatal)"
                      : "Accident"
                    : "Incident"}
                </div>
                {typeof d.fatalCount === "number" && d.isAccident && (
                  <div>Fatalities: {d.fatalCount}</div>
                )}
                {d.url && (
                  <div style={{ marginTop: 8 }}>
                    <a href={d.url} target="_blank" rel="noreferrer">
                      Open NTSB docket
                    </a>
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
