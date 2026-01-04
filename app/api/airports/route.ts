import { NextResponse } from "next/server";
import { XMLParser } from "fast-xml-parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AirportSeed = {
  code: string; // IATA (works for many major airports); FAA endpoint accepts lowercase too
  name: string;
  lat: number;
  lon: number;
};

const AIRPORTS: AirportSeed[] = [
  { code: "LAX", name: "Los Angeles Intl", lat: 33.9416, lon: -118.4085 },
  { code: "SFO", name: "San Francisco Intl", lat: 37.6213, lon: -122.379 },
  { code: "JFK", name: "John F. Kennedy Intl", lat: 40.6413, lon: -73.7781 },
  { code: "ORD", name: "Chicago O'Hare Intl", lat: 41.9742, lon: -87.9073 }
];

function normalizeStatus(rawStatus?: string, delay?: string) {
  const s = (rawStatus || "").toLowerCase();

  // FAA ASWS commonly uses these concepts; we keep it conservative.
  if (!rawStatus && !delay) return "unknown";
  if (s.includes("closed")) return "closed";
  if (s.includes("ground") && s.includes("stop")) return "ground_stop";
  if (s.includes("delay")) return "delay";

  // Sometimes "Delay" is its own field
  if ((delay || "").trim()) return "delay";

  // Default if FAA returns something but not one we map
  return rawStatus ? "normal" : "unknown";
}

export async function GET() {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_"
  });

  const updatedAt = new Date().toISOString();

  const results = await Promise.all(
    AIRPORTS.map(async (a) => {
      const code = a.code.toLowerCase();
      const url = `https://soa.smext.faa.gov/asws/api/airport/status/${code}`;

      try {
        const resp = await fetch(url, {
          cache: "no-store",
          headers: {
            // Some public endpoints behave better with an explicit UA
            "User-Agent": "aviation-safety-watch/1.0"
          }
        });

        if (!resp.ok) {
          return {
            ...a,
            status: "unknown",
            source: "FAA ASWS",
            updatedAt,
            note: `FAA HTTP ${resp.status}`
          };
        }

        const xml = await resp.text();
        const parsed = parser.parse(xml);

        // ASWS structure typically has AirportStatus as the root
        const root = parsed?.AirportStatus ?? parsed;

        const rawStatus: string | undefined = root?.Status;
        const delay: string | undefined = root?.Delay;
        const reason: string | undefined = root?.Reason;
        const trend: string | undefined = root?.Trend;
        const endTime: string | undefined = root?.EndTime;

        const status = normalizeStatus(rawStatus, delay);

        // Do NOT guess — if fields missing, return unknown/blank
        return {
          ...a,
          status,
          source: "FAA ASWS",
          updatedAt,
          faa: {
            Status: rawStatus ?? null,
            Delay: delay ?? null,
            Reason: reason ?? null,
            Trend: trend ?? null,
            EndTime: endTime ?? null
          }
        };
      } catch (e: any) {
        return {
          ...a,
          status: "unknown",
          source: "FAA ASWS",
          updatedAt,
          note: `Fetch error: ${e?.message || "unknown"}`
        };
      }
    })
  );

  return NextResponse.json({ updatedAt, airports: results });
}
