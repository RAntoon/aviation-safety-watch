import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Airport = {
  iata: string;
  icao: string;
  name: string;
  lat: number;
  lon: number;
};

const AIRPORTS: Airport[] = [
  { iata: "LAX", icao: "KLAX", name: "Los Angeles Intl", lat: 33.9416, lon: -118.4085 },
  { iata: "SFO", icao: "KSFO", name: "San Francisco Intl", lat: 37.6213, lon: -122.379 },
  { iata: "JFK", icao: "KJFK", name: "John F. Kennedy Intl", lat: 40.6413, lon: -73.7781 },
  { iata: "ORD", icao: "KORD", name: "Chicago O'Hare Intl", lat: 41.9742, lon: -87.9073 },
];

function pickTag(xml: string, tag: string): string | undefined {
  // very small XML helper (ASWS is simple)
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : undefined;
}

function pickBool(xml: string, tag: string): boolean | undefined {
  const v = pickTag(xml, tag);
  if (!v) return undefined;
  if (v.toLowerCase() === "true") return true;
  if (v.toLowerCase() === "false") return false;
  return undefined;
}

function mapToStatus(delay?: boolean, reason?: string): "normal" | "delay" | "ground_stop" | "unknown" {
  if (delay === true) {
    // Some ASWS reasons effectively represent ground stops / ground delays.
    const r = (reason ?? "").toLowerCase();
    if (r.includes("ground stop") || r.includes("groundstop")) return "ground_stop";
    return "delay";
  }
  if (delay === false) return "normal";
  return "unknown";
}

async function fetchAswsStatus(icao: string) {
  // FAA ASWS airport status endpoint (returns XML)
  const url = `https://soa.smext.faa.gov/asws/api/airport/status/${encodeURIComponent(icao)}`;

  const res = await fetch(url, {
    // “no-store” avoids stale edge caching while you iterate
    cache: "no-store",
    headers: {
      "User-Agent": "aviation-safety-watch (contact: admin)",
      Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
    },
  });

  const text = await res.text();

  if (!res.ok) {
    return { ok: false as const, status: res.status, body: text.slice(0, 500) };
  }

  return { ok: true as const, body: text };
}

export async function GET() {
  const updatedAt = new Date().toISOString();

  const statuses = await Promise.all(
    AIRPORTS.map(async (a) => {
      try {
        const r = await fetchAswsStatus(a.icao);
        if (!r.ok) {
          return {
            iata: a.iata,
            icao: a.icao,
            name: a.name,
            status: "unknown" as const,
            note: `FAA fetch failed (${r.status})`,
          };
        }

        const xml = r.body;

        const name = pickTag(xml, "Name") ?? a.name;
        const delay = pickBool(xml, "Delay");
        const reason = pickTag(xml, "Reason");
        const avgDelay = pickTag(xml, "AvgDelay");
        const trend = pickTag(xml, "Trend");
        const endTime = pickTag(xml, "EndTime");
        const lastUpdate = pickTag(xml, "Updated") ?? pickTag(xml, "LastUpdate") ?? pickTag(xml, "UpdateTime");

        const status = mapToStatus(delay, reason);

        return {
          iata: a.iata,
          icao: a.icao,
          name,
          status,
          raw: { delay, reason, avgDelay, trend, endTime, lastUpdate },
        };
      } catch (e: any) {
        return {
          iata: a.iata,
          icao: a.icao,
          name: a.name,
          status: "unknown" as const,
          note: "FAA fetch error",
        };
      }
    })
  );

  return NextResponse.json({ updatedAt, statuses });
}
