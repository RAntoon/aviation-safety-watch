import { NextResponse } from "next/server";

type AirportStatus = "normal" | "delay" | "ground_stop" | "unknown";

type Airport = {
  code: string;
  name: string;
  lat: number;
  lon: number;
  status: AirportStatus;
  note?: string;
};

// Minimal “known coordinates” list for MVP.
// (Coords are not the “status data”; they’re just where to plot the marker.)
const AIRPORTS: Record<string, { name: string; lat: number; lon: number }> = {
  LAX: { name: "Los Angeles Intl", lat: 33.9416, lon: -118.4085 },
  SFO: { name: "San Francisco Intl", lat: 37.6213, lon: -122.379 },
  JFK: { name: "John F. Kennedy Intl", lat: 40.6413, lon: -73.7781 },
  ORD: { name: "Chicago O'Hare Intl", lat: 41.9742, lon: -87.9073 },
};

// FAA Airport Status response varies; we only need delay-ish fields safely.
async function fetchFaaAirportStatus(code: string) {
  const url = `https://services.faa.gov/airport/status/${encodeURIComponent(code)}?format=json`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`FAA status fetch failed for ${code}: ${res.status}`);
  return res.json() as Promise<any>;
}

function normalizeStatus(faaJson: any): { status: AirportStatus; note?: string } {
  // Common shape: { delay: "true"/"false" or boolean, status: { reason, closureBegin, ... } }
  const delayVal = faaJson?.delay;
  const isDelay = delayVal === true || delayVal === "true";

  const reason =
    faaJson?.status?.reason ||
    faaJson?.status?.type ||
    faaJson?.status?.description ||
    faaJson?.reason;

  if (isDelay) return { status: "delay", note: reason ? String(reason) : "FAA reports delay" };

  // If the API ever indicates closure/ground stop explicitly, map it:
  const closure = faaJson?.status?.closureBegin || faaJson?.status?.closureEnd;
  if (closure) return { status: "ground_stop", note: reason ? String(reason) : "Possible closure" };

  return { status: "normal", note: reason ? String(reason) : undefined };
}

export async function GET() {
  const codes = Object.keys(AIRPORTS);

  const results: Airport[] = [];

  for (const code of codes) {
    try {
      const faa = await fetchFaaAirportStatus(code);
      const { status, note } = normalizeStatus(faa);

      results.push({
        code,
        name: AIRPORTS[code].name,
        lat: AIRPORTS[code].lat,
        lon: AIRPORTS[code].lon,
        status,
        note,
      });
    } catch (e: any) {
      // If FAA endpoint errors, we still return the airport but mark unknown (no fake data).
      results.push({
        code,
        name: AIRPORTS[code].name,
        lat: AIRPORTS[code].lat,
        lon: AIRPORTS[code].lon,
        status: "unknown",
        note: e?.message ?? "FAA fetch failed",
      });
    }
  }

  return NextResponse.json({
    updatedAt: new Date().toISOString(),
    airports: results,
  });
}
