import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

/* =========================
   Types
========================= */

type AnyRow = Record<string, any>;

type BlobManifestEntry = {
  from: string;
  to: string;
  blobUrl: string;
  label?: string;
};

type LatLng = { lat: number; lng: number };

/* =========================
   Helpers
========================= */

function parseDate(value: any): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

function toNumberOrNaN(v: any): number {
  if (v === null || v === undefined) return NaN;
  if (typeof v === "string" && v.trim() === "") return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function kindFor(row: AnyRow): "fatal" | "accident" | "incident" {
  const fatalCount =
    Number(row?.cm_fatalInjuryCount ?? 0) ||
    Number(row?.cm_injury_onboard_Fatal ?? 0) ||
    Number(row?.cm_injury_onground_Fatal ?? 0);

  if (fatalCount > 0 || String(row?.cm_highestInjury || "").toLowerCase() === "fatal") {
    return "fatal";
  }
  if (String(row?.cm_eventType || "").toUpperCase() === "ACC") return "accident";
  return "incident";
}

function norm(v: any): string {
  return v ? String(v).trim() : "";
}

/**
 * Builds geocode query in priority order:
 *  1) City, State, Country
 *  2) airportName + State + Country
 *  3) airportName + Country
 */
function buildGeoQuery(row: AnyRow): { cacheKey: string; label: string } | null {
  const city = norm(row?.cm_city);
  const state = norm(row?.cm_state);
  const country = norm(row?.cm_country);

  const airportName = norm(row?.airportName);

  // 1) City / State / Country
  if (city && state && country) {
    const label = `${city}, ${state}, ${country}`;
    const cacheKey = `geo:city:${label.toLowerCase()}`;
    return { cacheKey, label };
  }

  // 2) airportName + State + Country
  if (airportName && state && country) {
    const label = `${airportName}, ${state}, ${country}`;
    const cacheKey = `geo:apt:${label.toLowerCase()}`;
    return { cacheKey, label };
  }

  // 3) airportName + Country
  if (airportName && country) {
    const label = `${airportName}, ${country}`;
    const cacheKey = `geo:apt:${label.toLowerCase()}`;
    return { cacheKey, label };
  }

  return null;
}

async function fetchJsonArray(url: string): Promise<AnyRow[]> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch failed ${res.status}`);
  const parsed = JSON.parse(await res.text());
  return Array.isArray(parsed) ? parsed : [];
}

/* =========================
   KV Cache
   - Response cache (start/end) using setex TTL 24h
   - Geocode cache (geo:*) using setex TTL 90d
========================= */

const KV_URL = process.env.KV_REST_API_URL!;
const KV_TOKEN = process.env.KV_REST_API_TOKEN!;

const CACHE_TTL_SECONDS = 60 * 60 * 24; // 24 hours (response cache)
const GEOCODE_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days (geocode cache)

async function kvGet<T>(key: string): Promise<T | null> {
  const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const json = await res.json();
  if (!json?.result) return null;
  try {
    return JSON.parse(json.result);
  } catch {
    return null;
  }
}

async function kvSetEx(key: string, value: any, ttlSeconds: number) {
  const payload = encodeURIComponent(JSON.stringify(value));
  const url = `${KV_URL}/setex/${encodeURIComponent(key)}/${ttlSeconds}/${payload}`;
  await fetch(url, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    cache: "no-store",
  });
}

/* =========================
   Geocoding (Nominatim + KV)
========================= */

async function geocodeWithNominatim(label: string): Promise<LatLng | null> {
  const url =
    `https://nominatim.openstreetmap.org/search?` +
    `format=json&limit=1&addressdetails=0&q=${encodeURIComponent(label)}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "AviationSafetyWatch/1.0 (geocoder; contact: admin@aviationsafetywatch.com)",
      "Accept-Language": "en",
    },
    cache: "no-store",
  });

  if (!res.ok) return null;

  const arr = (await res.json()) as any[];
  if (!Array.isArray(arr) || arr.length === 0) return null;

  const lat = toNumberOrNaN(arr[0]?.lat);
  const lng = toNumberOrNaN(arr[0]?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return { lat, lng };
}

async function getCoordsFallback(
  row: AnyRow,
  budget: { remaining: number },
  stats: { cacheHits: number; geocoded: number; skippedNoQuery: number; skippedNoBudget: number }
): Promise<LatLng | null> {
  const q = buildGeoQuery(row);
  if (!q) {
    stats.skippedNoQuery += 1;
    return null;
  }

  // 1) KV geocode cache
  const cached = await kvGet<LatLng>(q.cacheKey);
  if (cached && Number.isFinite(cached.lat) && Number.isFinite(cached.lng)) {
    stats.cacheHits += 1;
    return cached;
  }

  // 2) No cache: respect per-request budget
  if (budget.remaining <= 0) {
    stats.skippedNoBudget += 1;
    return null;
  }
  budget.remaining -= 1;

  const fresh = await geocodeWithNominatim(q.label);
  if (!fresh) return null;

  stats.geocoded += 1;
  await kvSetEx(q.cacheKey, fresh, GEOCODE_TTL_SECONDS);

  return fresh;
}

/* =========================
   API Route
========================= */

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const startStr = searchParams.get("start") ?? "";
  const endStr = searchParams.get("end") ?? "";

  const cacheKey = `accidents:v1:${startStr}:${endStr}`;

  // 🔥 RESPONSE CACHE HIT
  const cached = await kvGet<any>(cacheKey);
  if (cached) {
    return NextResponse.json({ ...cached, cached: true });
  }

  const startT = Date.parse(startStr);
  const endT = Date.parse(endStr);
  const endInclusive = endT + 24 * 60 * 60 * 1000 - 1;

  const dataDir = path.join(process.cwd(), "data");
  const manifestPath = path.join(dataDir, "blob-manifest.json");

  const manifest: BlobManifestEntry[] = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  // Cap how many *new* geocodes happen per request (prevents slow loads / rate limits)
  const geocodeBudget = { remaining: 75 };
  const geocodeStats = {
    cacheHits: 0,
    geocoded: 0,
    skippedNoQuery: 0,
    skippedNoBudget: 0,
  };

  let totalRows = 0;
  let rowsWithCoords = 0;
  let rowsInRange = 0;
  const points: any[] = [];

  for (const block of manifest) {
    const blockFrom = Date.parse(block.from);
    const blockTo = Date.parse(block.to);

    if (endInclusive < blockFrom || startT > blockTo) continue;

    const rows = await fetchJsonArray(block.blobUrl);
    totalRows += rows.length;

    for (const row of rows) {
      const eventT = parseDate(row?.cm_eventDate);
      if (!eventT || eventT < startT || eventT > endInclusive) continue;
      rowsInRange++;

      // 1) Try direct coordinates first
      let lat = toNumberOrNaN(row?.cm_Latitude);
      let lng = toNumberOrNaN(row?.cm_Longitude);
      let hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

      // 2) Fallback geocode: city/state/country -> airportName...
      if (!hasCoords) {
        const fallback = await getCoordsFallback(row, geocodeBudget, geocodeStats);
        if (fallback) {
          lat = fallback.lat;
          lng = fallback.lng;
          hasCoords = true;
        }
      }

      if (!hasCoords) continue;
      rowsWithCoords++;

      const vehicle = row?.cm_vehicles?.[0];

      const tail = norm(vehicle?.registrationNumber);
      const make = norm(vehicle?.make);
      const model = norm(vehicle?.model);

      const aircraftType = [tail, make, model].filter(Boolean).join(" ");

      points.push({
        id: row?.cm_mkey ?? `${lat},${lng}`,
        lat,
        lng,
        kind: kindFor(row),
        date: row?.cm_eventDate?.slice(0, 10),
        city: row?.cm_city,
        state: row?.cm_state,
        country: row?.cm_country,
        ntsbCaseId: row?.cm_ntsbNum,
        aircraftType,
        summary: row?.prelimNarrative ?? row?.factualNarrative ?? row?.analysisNarrative,
      });
    }
  }

  const response = {
    ok: true,
    totalRows,
    rowsWithCoords,
    rowsInRange,
    points,
    debug: {
      geocode: {
        cacheHits: geocodeStats.cacheHits,
        geocodedThisRequest: geocodeStats.geocoded,
        budgetRemaining: geocodeBudget.remaining,
        skippedNoQuery: geocodeStats.skippedNoQuery,
        skippedNoBudget: geocodeStats.skippedNoBudget,
      },
    },
  };

  // 💾 RESPONSE CACHE STORE
  await kvSetEx(cacheKey, response, CACHE_TTL_SECONDS);

  return NextResponse.json({ ...response, cached: false });
}
