"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";

type Airport = {
  code: string;
  name: string;
  lat: number;
  lon: number;
  status: string;
  source?: string;
  updatedAt?: string;
  note?: string;
  faa?: {
    Status: string | null;
    Delay: string | null;
    Reason: string | null;
    Trend: string | null;
    EndTime: string | null;
  };
};

export default function MapView() {
  const [airports, setAirports] = useState<Airport[]>([]);
  const [updated, setUpdated] = useState<string>("");

  useEffect(() => {
    fetch("/api/airports", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        setAirports(data.airports || []);
        setUpdated(data.updatedAt || "");
      })
      .catch(() => {
        setAirports([]);
      });
  }, []);

  return (
    <div style={{ height: "100vh", width: "100vw" }}>
      {/* Header */}
      <div
        style={{
          position: "absolute",
          zIndex: 1000,
          padding: 12
        }}
      >
        <div
          style={{
            background: "white",
            padding: 10,
            borderRadius: 8,
            boxShadow: "0 2px 12px rgba(0,0,0,0.15)"
          }}
        >
          <div style={{ fontWeight: 700 }}>Aviation Safety Watch (MVP)</div>
          <div>Airports plotted: {airports.length}</div>
          <div style={{ fontSize: 12 }}>
            Source: FAA ASWS (official)
          </div>
          <div style={{ fontSize: 12 }}>
            Updated: {updated ? new Date(updated).toLocaleString() : "—"}
          </div>
        </div>
      </div>

      {/* Map */}
      <MapContainer
        center={[39.5, -98.35]}
        zoom={4}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution="© OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {airports.map((a) => (
          <CircleMarker
            key={a.code}
            center={[a.lat, a.lon]}
            radius={8}
          >
            <Popup>
              <div>
                <strong>{a.code}</strong> — {a.name}
                <br />
                Status: {a.status.toUpperCase()}
                <br />
                Source: {a.source || "FAA"}
                {a.faa && (
                  <>
                    <hr />
                    <div>FAA Status: {a.faa.Status ?? "—"}</div>
                    <div>Delay: {a.faa.Delay ?? "—"}</div>
                    <div>Reason: {a.faa.Reason ?? "—"}</div>
                    <div>Trend: {a.faa.Trend ?? "—"}</div>
                    <div>End: {a.faa.EndTime ?? "—"}</div>
                  </>
                )}
                {a.note && (
                  <>
                    <hr />
                    <div style={{ color: "crimson" }}>{a.note}</div>
                  </>
                )}
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
