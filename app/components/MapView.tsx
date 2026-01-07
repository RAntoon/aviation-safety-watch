"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import * as RL from "react-leaflet";
import ClockWidget from "./ClockWidget";

const MapContainer = RL.MapContainer as unknown as React.FC<any>;
const TileLayer = RL.TileLayer as unknown as React.FC<any>;
const CircleMarker = RL.CircleMarker as unknown as React.FC<any>;
const Popup = RL.Popup as unknown as React.FC<any>;
const ZoomControl = RL.ZoomControl as unknown as React.FC<any>;

type PointKind = "fatal" | "accident" | "incident";

type MapPoint = {
  id: string;
  lat: number;
  lng: number;
  kind: PointKind;

  date?: string;
  city?: string;
  state?: string;
  country?: string;

  ntsbCaseId?: string;
  docketUrl?: string;
  summary?: string;
  aircraftType?: string;
};

function isoDate(d: Date) {
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

function colorFor(kind: PointKind) {
  if (kind === "fatal") return "#d32f2f";
  if (kind === "accident") return "#fb8c00";
  return "#fdd835";
}

export default function MapView() {
  const defaultRange = useMemo(() => last12MonthsRange(), []);
  const [start, setStart] = useState(isoDate(defaultRange.start));
  const [end, setEnd] = useState(isoDate(defaultRange.end));
  const [points, setPoints] = useState<MapPoint[]>([]);
  const [status, setStatus] = useState("Idle");
  const [loading, setLoading] = useState(false);

  const center: LatLngExpression = [39.5, -98.35];

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/accidents?start=${start}&end=${end}`, {
        cache: "no-store",
      });
      const json = await res.json();
      setPoints(json.points || []);
      setStatus(
        `OK. Loaded ${json.points?.length ?? 0} points.`
      );
    } catch {
      setStatus("Fetch failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div style={{ height: "100vh", width: "100vw", position: "relative" }}>
      <ClockWidget />

      <MapContainer
        center={center}
        zoom={4}
        scrollWheelZoom
        zoomControl={false}
        style={{ height: "100%", width: "100%" }}
      >
        <ZoomControl position="bottomright" />

        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {points.map((p) => (
          <CircleMarker
            key={p.id}
            center={[p.lat, p.lng]}
            radius={7}
            pathOptions={{
              color: "#333",
              weight: 1,
              fillColor: colorFor(p.kind),
              fillOpacity: 0.9,
            }}
          >
            <Popup>
              <div style={{ fontFamily: "system-ui" }}>
                <div
                  style={{
                    fontWeight: 800,
                    marginBottom: 6,
                  }}
                >
                  {p.kind === "fatal"
                    ? "Fatal Accident"
                    : p.kind === "accident"
                    ? "Accident"
                    : "Incident"}
                  {p.aircraftType ? ` – ${p.aircraftType}` : ""}
                </div>

                {p.date && (
                  <div>
                    <b>Date:</b> {p.date}
                  </div>
                )}
                {(p.city || p.state || p.country) && (
                  <div>
                    <b>Location:</b>{" "}
                    {[p.city, p.state, p.country]
                      .filter(Boolean)
                      .join(", ")}
                  </div>
                )}
                {p.ntsbCaseId && (
                  <div>
                    <b>NTSB Case:</b> {p.ntsbCaseId}
                  </div>
                )}

                {p.summary && (
                  <div style={{ marginTop: 8 }}>{p.summary}</div>
                )}

                {p.docketUrl && (
                  <a
                    href={p.docketUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontWeight: 800, display: "block", marginTop: 10 }}
                  >
                    Open NTSB docket →
                  </a>
                )}
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
