import { NextResponse } from "next/server";

export const runtime = "nodejs"; // IMPORTANT: avoid Edge fetch quirks
export const dynamic = "force-dynamic";

type AirportSeed = {
  code: string; // IATA
  name: string;
  lat: number;
  lon: number;
};

const AIRPORTS: AirportSeed[] = [
  { code: "LAX", name: "Los Angeles Intl", lat: 33.9416, lon: -118.4085 },
  { code: "SFO", name: "San Francisco Intl", lat: 37.6213, lon: -122.3790 },
  { code: "JFK", name: "John F. Kennedy Intl", lat: 40.6413, lon: -73.7781 },
  { code: "ORD", name: "Chicago O'Hare Intl", lat: 41.9742, lon: -87.9073 },
];

async function fetchFaaAirportStatus(iata: string) {
  const url = `https://soa.smext.faa.gov/asws/api/airport/status/${encodeURIComponent(
    iata
  )}`;

  // Some government endpoints behave better with a UA + accept header.
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": "AviationSafetyWatchMVP/1.0 (contact: admin@aviationsafetywatch.com)",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    return {
      ok: false as const,
      httpStatus: res.status,
      data: null,
    };
  }

  const data = await res.json();
  return { ok: true as const, httpStatus: res.status, data };
}

function normalizeStatusFromFaaJson(faaJson: any) {
  // We DO NOT guess. We only map what FAA explicitly provides.
  const statusObj = faaJson?.Status ?? {};
  const delay = Boolean(statusObj?.Delay);
  const groundStop = Boolean(statusObj?.GroundStop);
  const reason: string | undefined = statusObj?.Reason;
  const closure: string | undefined = statusObj?.ClosureBegin; // sometimes present
  const end: string | undefined = statusObj?.EndTime; // sometimes present

  let status: "normal" | "delay" | "ground_stop" | "unknown" = "unknown";
  if (groundStop) status = "ground_stop";
  else if (delay) status = "delay";
  else if (typeof statusObj?.Reason === "string" || statusObj?.Delay === false) status = "normal";

  return {
    status,
    reason: reason ?? null,
    closureBegin: closure ?? null,
    endTime: end ?? null,
  };
}

export async function GET() {
  const updatedAt = new Date().toISOString();

  const results = await Promise.all(
    AIRPORTS.map(async (a) => {
      try {
        const faa = await fetchFaaAirportStatus(a.code);

        if (!faa.ok) {
          return {
            ...a,
            status: "unknown" as const,
            source: "FAA ASWS",
            updatedAt,
            note: `FAA HTTP ${faa.httpStatus}`,
          };
        }

        const normalized = normalizeStatusFromFaaJson(faa.data);

        return {
          ...a,
          status: normalized.status,
          source: "FAA ASWS",
          updatedAt,
          note: normalized.reason ?? null,
          raw: {
            // keep a small slice for transparency/debug
            Delay: faa.data?.Status?.Delay ?? null,
            GroundStop: faa.data?.Status?.GroundStop ?? null,
            Reason: faa.data?.Status?.Reason ?? null,
          },
        };
      } catch (e: any) {
        return {
          ...a,
          status: "unknown" as const,
          source: "FAA ASWS",
          updatedAt,
          note: `Fetch error`,
        };
      }
    })
  );

  return NextResponse.json({
    updatedAt,
    airports: results,
  });
}
