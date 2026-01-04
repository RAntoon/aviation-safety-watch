import { NextResponse } from "next/server";

type Airport = {
  code: string; // IATA (e.g., "LAX")
  name: string;
  lat: number;
  lon: number;
};

type AirportStatus = {
  code: string;
  name: string;
  lat: number;
  lon: number;
  status: "normal" | "delay" | "ground_stop" | "closed" | "unknown";
  faaRaw?: any;
  sourceError?: string;
};

const AIRPORTS: Airport[] = [
  // MVP list — verified coordinates (do not plot anything without real coords)
  { code: "LAX", name: "Los Angeles Intl", lat: 33.9416, lon: -118.4085 },
  { code: "SFO", name: "San Francisco Intl", lat: 37.6213, lon: -122.3790 },
  { code: "JFK", name: "John F. Kennedy Intl", lat: 40.6413, lon: -73.7781 },
  { code: "ORD", name: "Chicago O'Hare Intl", lat: 41.9742, lon: -87.9073 },
];

function isValidLatLon(lat: number, lon: number) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

async function fetchFaaAirportStatus(iata: string) {
  // Common FAA endpoint used in many examples:
  // https://services.faa.gov/airport/status/{IATA}?format=json
  // (If this ever becomes unreliable, we can swap to another FAA/NAS data source.)
  const url = `https://services.faa.gov/airport/status/${encodeURIComponent(
    iata
  )}?format=json`;

  const res = await fetch(url, {
    // Vercel/server fetch (no browser CORS issues)
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`FAA HTTP ${res.status}`);
  }

  return await res.json();
}

function normalizeStatus(faaJson: any): AirportStatus["status"] {
  // FAA response varies; usually includes delay: true/false and status.reason, etc.
  // We'll keep this conservative and transparent.
  if (!faaJson) return "unknown";

  // Some responses have "status" object or string-ish fields.
  const delayFlag = Boolean(faaJson.delay);

  const statusText =
    (typeof faaJson.status === "string" ? faaJson.status : faaJson?.status?.type) ??
    "";
  const reasonText =
    (typeof faaJson?.status?.reason === "string" ? faaJson.status.reason : "") ?? "";

  const combined = `${statusText} ${reasonText}`.toLowerCase();

  if (combined.includes("closed")) return "closed";
  if (combined.includes("ground stop")) return "ground_stop";
  if (delayFlag) return "delay";

  // If FAA explicitly says no delay, call it normal
  if (faaJson.delay === false) return "normal";

  return "unknown";
}

export async function GET() {
  const updatedAt = new Date().toISOString();

  const results: AirportStatus[] = await Promise.all(
    AIRPORTS.map(async (a) => {
      // Never allow “ORD in Africa” — if coords invalid, do not plot.
      if (!isValidLatLon(a.lat, a.lon)) {
        return {
          code: a.code,
          name: a.name,
          lat: a.lat,
          lon: a.lon,
          status: "unknown",
          sourceError: "Invalid lat/lon (not plotted)",
        };
      }

      try {
        const faa = await fetchFaaAirportStatus(a.code);
        return {
          code: a.code,
          name: a.name,
          lat: a.lat,
          lon: a.lon,
          status: normalizeStatus(faa),
          faaRaw: faa, // keep raw so we can debug and refine mapping
        };
      } catch (e: any) {
        return {
          code: a.code,
          name: a.name,
          lat: a.lat,
          lon: a.lon,
          status: "unknown",
          sourceError: String(e?.message ?? e),
        };
      }
    })
  );

  // Filter out anything with invalid coords (hard safety rule)
  const plotted = results.filter((r) => isValidLatLon(r.lat, r.lon));

  return NextResponse.json({
    updatedAt,
    airports: plotted,
  });
}
