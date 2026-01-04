"use client";

import { useEffect, useMemo, useState } from "react";
import type { LatLngExpression } from "leaflet";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";

type Airport = {
  code: string;
  name: string;
  lat: number;
  lon: number;
  status: "normal" | "delay" | "ground_stop";
  note?: string;
};

type AirportsResponse = {
  updatedAt: string;
  airports: Airport[];
};

function colorForStatus(status: Airport["status"]) {
  switch (status) {
    case "delay":
      return "#f59e0b"; // amber
    case "ground_stop":
      return "#ef4444"; // red
    default:
      return "#22c55e"; // green
  }
}

export default function MapView() {
  const center = useMemo<LatLngExpression>(() => [39.5, -98.35], []); // Continental US
  const [data, setData] = useState<AirportsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/airports", { cache: "no-store" });
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const json = (await res.json()) as AirportsResponse;
        if (!cancelled) setData(json);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? "Unknown error");
      }
    }

    load();
    const t = setInterval(load, 60_000); // refresh every minute
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return (
    <div style={{ height: "100vh", width: "100vw" }}>
      {/* simple status header */}
      <div style={{ position: "absolute", zIndex: 1000, padding: 12 }}>
        <div style={{ background: "white", padding: 10, borderRadius: 8, boxShadow: "0 2px 12px rgba(0,0,0,0.12)" }}>
          <div style={{ fontWeight: 700 }}>Aviation Safety Watch</div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            {err ? `Error: ${err}` : data ? `Updated: ${new Date(data.updatedAt).toLocaleString()}` : "Loading..."}
          </div>
        </div>
      </div>

      <MapContainer center={center} zoom={4} scrollWheelZoom={true} style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution='&copy; OpenStreetMap
