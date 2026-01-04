import { NextResponse } from "next/server";

export const runtime = "nodejs"; // makes fetch behavior more predictable on Vercel

const AIRPORTS = ["LAX", "SFO", "JFK", "ORD"];

// FAA Airport Status (ASWS). If this endpoint is blocked/changes, we’ll swap it next.
function faaUrl(code: string) {
  return `https://services.faa.gov/airport/status/${encodeURIComponent(code)}?format=json`;
}

export async function GET() {
  const updatedAt = new Date().toISOString();

  const results = await Promise.all(
    AIRPORTS.map(async (code) => {
      try {
        const res = await fetch(faaUrl(code), {
          // Some gov endpoints behave better with explicit headers
          headers: {
            "Accept": "application/json",
            "User-Agent": "aviation-safety-watch/1.0 (contact: admin@aviationsafetywatch.com)",
          },
          cache: "no-store",
        });

        if (!res.ok) {
          return {
            code,
            name: code,
            lat: 0,
            lon: 0,
            status: "unknown",
            note: `FAA request failed: HTTP ${res.status}`,
          };
        }

        const data: any = await res.json();

        // Typical fields (can vary by airport / FAA)
        const name = data?.name ?? code;
        const statusRaw =
          data?.status?.type ??
          data?.status?.reason ??
          data?.status?.closure ??
          data?.status ??
          "unknown";

        // Best-effort normalization
        const statusText = String(statusRaw).toLowerCase();
        let status: "normal" | "delay" | "ground_stop" | "unknown" = "unknown";

        if (statusText.includes("ground") && statusText.includes("stop")) status = "ground_stop";
        else if (statusText.includes("delay")) status = "delay";
        else if (statusText.includes("normal") || statusText.includes("no delays")) status = "normal";

        // FAA response often includes latitude/longitude; if not, we’ll add a fallback later.
        const lat = Number(data?.latitude ?? data?.lat ?? 0);
        const lon = Number(data?.longitude ?? data?.lon ?? 0);

        return {
          code,
          name,
          lat,
          lon,
          status,
          note: data?.status?.reason ?? data?.status?.avgDelay ?? "",
        };
      } catch (err: any) {
        return {
          code,
          name: code,
          lat: 0,
          lon: 0,
          status: "unknown",
          note: `fetch failed: ${err?.message ?? String(err)}`,
        };
      }
    })
  );

  return NextResponse.json({ updatedAt, airports: results });
}
