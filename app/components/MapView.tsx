"use client";

import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";

type NtsbCase = {
  NtsbNumber?: string;
  EventDate?: string;
  City?: string;
  State?: string;
  Latitude?: number;
  Longitude?: number;
  InjurySeverity?: string;
};

export default function MapView({ cases }: { cases: NtsbCase[] }) {
  return (
    <MapContainer
      style={{ height: "100vh", width: "100%" }}
      zoom={4}
      center={[39.5, -98.35]}
      scrollWheelZoom
    >
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

      {cases
        .filter((c) => typeof c.Latitude === "number" && typeof c.Longitude === "number")
        .map((c, i) => (
          <CircleMarker
            key={c.NtsbNumber ?? i}
            center={[c.Latitude as number, c.Longitude as number]}
            radius={6}
            pathOptions={{ color: "red" }}
          >
            <Popup>
              <strong>NTSB Case</strong>
              <br />
              {c.City}, {c.State}
              <br />
              Date: {c.EventDate ?? "Unknown"}
              <br />
              Severity: {c.InjurySeverity ?? "Unknown"}
              <br />
              {c.NtsbNumber ? (
                <a
                  href={`https://data.ntsb.gov/Docket?NTSBNumber=${c.NtsbNumber}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View NTSB Docket
                </a>
              ) : (
                <span>No docket link</span>
              )}
            </Popup>
          </CircleMarker>
        ))}
    </MapContainer>
  );
}
