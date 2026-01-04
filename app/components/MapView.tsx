'use client';

import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

type AirportStatus = {
  code: string;
  name: string;
  lat: number;
  lon: number;
  status: string;
  source?: string;
  updated?: string;
  note?: string;
};

// Fix Leaflet marker icons (Vercel / Next.js issue)
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

export default function MapView() {
  const [airports, setAirports] = useState<AirportStatus[]>([]);
  const [updated, setUpdated] = useState<string>('—');

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/airports', { cache: 'no-store' });
        const data = await res.json();

        setAirports(data.airports ?? []);
        setUpdated(data.updatedAt ?? '—');
      } catch {
        setAirports([]);
      }
    }

    load();
  }, []);

  const center: [number, number] = [39.5, -98.35]; // Continental US

  return (
    <div style={{ height: '100vh', width: '100vw' }}>
      {/* Header */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          zIndex: 1000,
          background: 'white',
          padding: 10,
          borderRadius: 8,
          boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
          maxWidth: 300,
          fontSize: 14,
        }}
      >
        <strong>Aviation Safety Watch (MVP)</strong>
        <div>Airports plotted: {airports.length}</div>
        <div>FAA source: NAS Status (official)</div>
        <div>Updated: {updated}</div>
      </div>

      {/* Map */}
      <MapContainer
        {...({
          center,
          zoom: 4,
          scrollWheelZoom: true,
          style: { height: '100%', width: '100%' },
        } as any)}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {airports.map((a) => (
          <Marker key={a.code} position={[a.lat, a.lon]}>
            <Popup>
              <strong>
                {a.code} — {a.name}
              </strong>
              <br />
              Status: {a.status}
              <br />
              Source: {a.source ?? 'FAA'}
              <br />
              Updated: {a.updated ?? '—'}
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
