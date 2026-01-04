"use client";

import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix Leaflet marker icons in Next.js
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

export default function MapView() {
  // TEMP static data (we’ll replace with API fetch next)
  const airports = [
    {
      code: "LAX",
      name: "Los Angeles Intl",
      lat: 33.9416,
      lon: -118.4085,
      status: "normal",
    },
    {
      code: "SFO",
      name: "San Francisco Intl",
      lat: 37.6213,
      lon: -122.379,
      status: "delay",
      note: "Sample delay",
    },
    {
      code: "JFK",
      name: "John F. Kennedy Intl",
      lat: 40.6413,
      lon: -73.7781,
      status: "normal",
    },
    {
      code: "ORD",
      name: "Chicago O'Hare Intl",
      lat: 41.9742,
      lon: -87.9073,
      status: "ground_stop",
      note: "Sample ground stop",
    },
  ];

  return (
    <div style={{ height: "100vh", width: "100vw" }}>
      <MapContainer
        center={[39.5, -98.35]} // Continental US
        zoom={4}
        scrollWheelZoom={true}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {airports.map((a) => (
          <Marker key={a.code} position={[a.lat, a.lon]}>
            <Popup>
              <strong>{a.code}</strong>
              <br />
              {a.name}
              <br />
              Status: {a.status}
              {a.note && (
                <>
                  <br />
                  Note: {a.note}
                </>
              )}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
