"use client";

import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useState } from "react";

type Airport = {
  code: string;
  name: string;
  lat: number;
  lon: number;
  status: string;
  note?: string;
};

export default function MapView() {
  const [airports, setAirports] = useState<Airport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadAirports() {
      const res = await fetch("/api/airports");
      const data = await res.json();
      setAirports(data.airports);
      setLoading(false);
    }
    loadAirports();
  }, []);

  if (loading) return <p>Loading map…</p>;

  return (
    <MapContainer
      center={[39.5, -98.35]} // continental US
      zoom={4}
      style={{ height: "90vh", width: "100%" }}
    >
      <TileLayer
        attribution="&copy; OpenStreetMap contributors"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {airports.map((airport) => (
        <CircleMarker
          key={airport.code}
          center={[airport.lat, airport.lon]}
          radius={8}
          pathOptions={{
            color:
              airport.status === "normal"
                ? "green"
                : airport.status === "delay"
                ? "orange"
                : "red",
          }}
        >
          <Popup>
            <strong>{airport.code}</strong><br />
            {airport.name}<br />
            Status: {airport.status}<br />
            {airport.note && <em>{airport.note}</em>}
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
