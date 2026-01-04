"use client";

import { useEffect, useState } from "react";

type Airport = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  category: string;
};

export default function MapView() {
  const [airports, setAirports] = useState<Airport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadAirports() {
      try {
        const res = await fetch("/api/airports");
        const data = await res.json();
        setAirports(data);
      } catch (err) {
        console.error("Failed to load airports", err);
      } finally {
        setLoading(false);
      }
    }

    loadAirports();
  }, []);

  if (loading) {
    return <p>Loading map data…</p>;
  }

  return (
    <div>
      <h1>Map placeholder</h1>
      <p>If you see this, MapView is rendering correctly.</p>

      <pre style={{ marginTop: 20 }}>
        {JSON.stringify(airports, null, 2)}
      </pre>
    </div>
  );
}
