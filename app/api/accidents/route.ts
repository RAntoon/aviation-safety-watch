import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

type AnyRow = Record<string, any>;

type LocalManifestEntry = {
  from: string;
  to: string;
  file: string;
};

type BlobManifestEntry = {
  from: string;
  to: string;
  blobUrl: string;
  label?: string;
};

function parseDate(value: any): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
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

/**
 * Fix: Number(null) => 0. We treat null/undefined/"" as missing instead.
 */
function toNumberOrNaN(v: any): number {
  if (v === null || v === undefined) return NaN;
  if (typeof v === "string" && v.trim() === "") return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function locationKey(row: AnyRow): string | null {
  const city = row?.cm_city ? String(row.cm_city).trim() : "";
  const state = row?.cm_state ? String(row.cm_state).trim() : "";
  const country = row?.cm_country ? String(row.cm_country).trim() : "";

  const parts = [city, state, country].filter(Boolean);
  if (parts.length < 2) return null; // need at least city+state (or city+country)
  return parts.join(", ").toLowerCase();
}

function locationLabel(row: AnyRow): string | null {
  const city = row?.cm_city ? String(row.cm_city).trim() : "";
  const state = row?.cm_state ? String(row.cm_state).trim() : "";
  const country = row?.cm_country ? String(row.cm_country).trim() : "";
  const parts = [city, state, country].filter(Boolean);
  if (parts.length < 2) return null;
  return parts.join(", ");
}

async function fetchJsonArray(url: string): Promise<AnyRow[]> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch failed ${res.status} for ${url}`);
  const text = await res.text();
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * ---------- KV-backed Geocoding (no extra local database file) ----------
 */
const KV_URL = process.env.KV_REST_API_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || "";
const KV_ENABLED = Boolean(KV_URL && KV_TOKEN);

async function kvGetJson<T>(key: string): Promise<T | null> {
  if (!KV_ENABLED) return null;
  const url = `${KV_URL}/get/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = await res.json();
  const raw = data?.result;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function kvSetJson(key: string, value: any): Promise<void> {
  if (!KV_ENABLED) return;
  const payload = JSON.stringify(value);
  const url = `${KV_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(payload)}`;
  await fetch(url, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    cache: "no-store",
  }).catch(() => {});
}

type LatLng = { lat: number; lng: number };

async function geocodeWithNominatim(query: string): Promise<LatLng | null> {
  const url =
    `https://nominatim.openstreetmap.org/search?` +
    `format=json&limit=1&addressdetails=0&q=${encodeURIComponent(query)}`;

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

async function getCoordsForRowViaKV(
  row: AnyRow,
  geocodeBudget: { remaining: number },
  stats: { cacheHits: number; geocoded: number }
): Promise<LatLng | null> {
  const key = locationKey(row);
  const label = locationLabel(row);
  if (!key || !label) return null;

  const cacheKey = `geo:${key}`;

  const cached = await kvGetJson<LatLng>(cacheKey);
  if (cached && Number.isFinite(cached.lat) && Number.isFinite(cached.lng)) {
    stats.cacheHits += 1;
    return cached;
  }

  if (geocodeBudget.remaining <= 0) return null;
  geocodeBudget.remaining -= 1;

  const result = await geocodeWithNominatim(label);
  if (!result) return null;

  stats.geocoded += 1;
  await kvSetJson(cacheKey, result);

  return result;
}

/* -------------------- Aircraft display helpers -------------------- */

function cleanToken(v: any): string {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  if (!s) return "";
  const up = s.toUpperCase();
  if (up === "N/A" || up === "NA" || up === "UNKNOWN" || up === "UNK" || up === "-") return "";
  return s;
}

function normalizeTail(v: any): string {
  const s = cleanToken(v);
  if (!s) return "";
  return s.replace(/\s+/g, "").toUpperCase();
}

/**
 * Combine make/model/series and tail into:
 *   "N123FR Cirrus SR22T"
 *   "Luscombe 8A"
 */
function buildAircraftDisplay(row: AnyRow, vehicle0: any): { aircraftType?: string; aircraftDisplay?: string; tailNumber?: string } {
  // Tail candidates (depending on export structure)
  const tail =
    normalizeTail(
      vehicle0?.registration ??
        vehicle0?.reg ??
        vehicle0?.tail ??
        vehicle0?.tailNumber ??
        vehicle0?.nNumber ??
        vehicle0?.aircraftRegistration ??
        row?.cm_registration ??
        row?.cm_tailNumber ??
        row?.cm_nNumber ??
        row?.registration ??
        row?.tailNumber
    ) || "";

  // Make/model/series candidates
  const make = cleanToken(vehicle0?.make ?? vehicle0?.manufacturer ?? row?.cm_make ?? row?.make);
  const model = cleanToken(
    vehicle0?.model ??
      vehicle0?.modelName ??
      row?.cm_model ??
      row?.model ??
      row?.aircraftType // last-resort fallback
  );
  const series = cleanToken(vehicle0?.series ?? vehicle0?.variant ?? row?.cm_series ?? row?.series);

  // Handle "8" + "A" => "8A" (Luscombe 8A)
  const modelPlusSeries =
    model && series && /^[A-Za-z0-9]{1,4}$/.test(model) && /^[A-Za-z0-9]{1,4}$/.test(series)
      ? `${model}${series}`
      : model;

  const makeModel = [make, modelPlusSeries].filter(Boolean).join(" ").trim();

  // Back-compat “aircraftType” (what you used before)
  const aircraftType = makeModel || undefined;

  // New UI string
  const aircraftDisplay =
    tail && makeModel ? `${tail} ${makeModel}` : makeModel ? makeModel : tail ? tail : undefined;

  return { aircraftType, aircraftDisplay, tailNumber: tail || undefined };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const startStr = searchParams.get("start");
  const endStr = searchParams.get("end");
  const q = searchParams.get("q"); // kept for future search use; unused here

  const startT = startStr ? Date.parse(startStr) : NaN;
  const endT = endStr ? Date.parse(endStr) : NaN;
  const endInclusive = Number.isFinite(endT) ? endT + 24 * 60 * 60 * 1000 - 1 : NaN;

  const dataDir = path.join(process.cwd(), "data");

  const useBlob = String(process.env.USE_BLOB_DATA || "").toLowerCase() === "true";

  const blobManifestPath = path.join(dataDir, "blob-manifest.json");
  const localManifestPath = path.join(dataDir, "manifest.json");

  // cap new geocodes per request (prevents timeouts + rate limit issues)
  const geocodeBudget = { remaining: 25 };
  const geocodeStats = { cacheHits: 0, geocoded: 0 };

  if (useBlob) {
    if (!fs.existsSync(blobManifestPath)) {
      return NextResponse.json(
        {
          ok: false,
          error: "blob-manifest.json not found",
          points: [],
          debug: { useBlob, manifestPath: "data/blob-manifest.json", q, start: startStr, end: endStr },
        },
        { status: 500 }
      );
    }

    const manifest: BlobManifestEntry[] = JSON.parse(fs.readFileSync(blobManifestPath, "utf8"));

    let totalRows = 0;
    let rowsWithCoords = 0;
    let rowsInRange = 0;
    const points: any[] = [];
    const blocksLoaded: string[] = [];

    for (const block of manifest) {
      const blockFrom = Date.parse(block.from);
      const blockTo = Date.parse(block.to);

      if (
        Number.isFinite(startT) &&
        Number.isFinite(endInclusive) &&
        (endInclusive < blockFrom || startT > blockTo)
      ) {
        continue;
      }

      let rows: AnyRow[] = [];
      try {
        rows = await fetchJsonArray(block.blobUrl);
        blocksLoaded.push(block.label ?? block.blobUrl);
      } catch {
        blocksLoaded.push(`${block.label ?? block.blobUrl} (FETCH/PARSE ERROR)`);
        continue;
      }

      totalRows += rows.length;

      for (const row of rows) {
        const eventT = parseDate(row?.cm_eventDate);
        const inRange =
          eventT !== null &&
          Number.isFinite(startT) &&
          Number.isFinite(endInclusive) &&
          eventT >= startT &&
          eventT <= endInclusive;

        if (inRange) rowsInRange++;
        if (!inRange) continue;

        // coords priority, but null/"" is missing (NOT zero)
        let lat = toNumberOrNaN(row?.cm_Latitude);
        let lng = toNumberOrNaN(row?.cm_Longitude);
        let hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

        // Fallback: city/state/country via KV-cached geocode (ONLY if missing coords)
        if (!hasCoords) {
          const fallback = await getCoordsForRowViaKV(row, geocodeBudget, geocodeStats);
          if (fallback) {
            lat = fallback.lat;
            lng = fallback.lng;
            hasCoords = true;
          }
        }

        if (hasCoords) rowsWithCoords++;
        if (!hasCoords) continue;

        const ntsbNum = row?.cm_ntsbNum ? String(row.cm_ntsbNum) : undefined;

        const vehicle0 = Array.isArray(row?.cm_vehicles) ? row.cm_vehicles[0] : undefined;

        const { aircraftType, aircraftDisplay, tailNumber } = buildAircraftDisplay(row, vehicle0);

        const narrative =
          row?.prelimNarrative ??
          row?.factualNarrative ??
          row?.analysisNarrative ??
          undefined;

        points.push({
          id: String(row?.cm_mkey ?? ntsbNum ?? `${lat},${lng}`),
          lat,
          lng,
          kind: kindFor(row),

          date: row?.cm_eventDate ? String(row.cm_eventDate).slice(0, 10) : undefined,
          city: row?.cm_city ?? undefined,
          state: row?.cm_state ?? undefined,
          country: row?.cm_country ?? undefined,

          ntsbCaseId: ntsbNum,
          docketUrl: ntsbNum
            ? `https://data.ntsb.gov/Docket/?NTSBNumber=${encodeURIComponent(ntsbNum)}`
            : undefined,

          // Back-compat (old)
          aircraftType,

          // New (use this in popup title)
          aircraftDisplay,
          tailNumber,

          summary: narrative ? String(narrative).slice(0, 240) : undefined,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      totalRows,
      rowsWithCoords,
      rowsInRange,
      points,
      debug: {
        useBlob,
        manifestEntries: manifest.length,
        blocksLoaded,
        kvEnabled: KV_ENABLED,
        geocode: {
          cacheHits: geocodeStats.cacheHits,
          geocodedThisRequest: geocodeStats.geocoded,
          budgetRemaining: geocodeBudget.remaining,
        },
      },
    });
  }

  // ----- Local mode -----
  if (!fs.existsSync(localManifestPath)) {
    return NextResponse.json(
      {
        ok: false,
        error: "manifest.json not found",
        points: [],
        debug: { useBlob, manifestPath: "data/manifest.json", q, start: startStr, end: endStr },
      },
      { status: 500 }
    );
  }

  const manifest: LocalManifestEntry[] = JSON.parse(fs.readFileSync(localManifestPath, "utf8"));

  let totalRows = 0;
  let rowsWithCoords = 0;
  let rowsInRange = 0;
  const points: any[] = [];

  for (const block of manifest) {
    const blockFrom = Date.parse(block.from);
    const blockTo = Date.parse(block.to);

    if (
      Number.isFinite(startT) &&
      Number.isFinite(endInclusive) &&
      (endInclusive < blockFrom || startT > blockTo)
    ) {
      continue;
    }

    const filePath = path.join(dataDir, block.file);
    if (!fs.existsSync(filePath)) continue;

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const rows: AnyRow[] = Array.isArray(parsed) ? parsed : [];

    totalRows += rows.length;

    for (const row of rows) {
      const eventT = parseDate(row?.cm_eventDate);
      const inRange =
        eventT !== null &&
        Number.isFinite(startT) &&
        Number.isFinite(endInclusive) &&
        eventT >= startT &&
        eventT <= endInclusive;

      if (inRange) rowsInRange++;
      if (!inRange) continue;

      let lat = toNumberOrNaN(row?.cm_Latitude);
      let lng = toNumberOrNaN(row?.cm_Longitude);
      let hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

      if (!hasCoords) {
        const fallback = await getCoordsForRowViaKV(row, geocodeBudget, geocodeStats);
        if (fallback) {
          lat = fallback.lat;
          lng = fallback.lng;
          hasCoords = true;
        }
      }

      if (hasCoords) rowsWithCoords++;
      if (!hasCoords) continue;

      const ntsbNum = row?.cm_ntsbNum ? String(row.cm_ntsbNum) : undefined;

      const vehicle0 = Array.isArray(row?.cm_vehicles) ? row.cm_vehicles[0] : undefined;

      const { aircraftType, aircraftDisplay, tailNumber } = buildAircraftDisplay(row, vehicle0);

      const narrative =
        row?.prelimNarrative ??
        row?.factualNarrative ??
        row?.analysisNarrative ??
        undefined;

      points.push({
        id: String(row?.cm_mkey ?? ntsbNum ?? `${lat},${lng}`),
        lat,
        lng,
        kind: kindFor(row),

        date: row?.cm_eventDate ? String(row.cm_eventDate).slice(0, 10) : undefined,
        city: row?.cm_city ?? undefined,
        state: row?.cm_state ?? undefined,
        country: row?.cm_country ?? undefined,

        ntsbCaseId: ntsbNum,
        docketUrl: ntsbNum
          ? `https://data.ntsb.gov/Docket/?NTSBNumber=${encodeURIComponent(ntsbNum)}`
          : undefined,

        aircraftType,
        aircraftDisplay,
        tailNumber,

        summary: narrative ? String(narrative).slice(0, 240) : undefined,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    totalRows,
    rowsWithCoords,
    rowsInRange,
    points,
    debug: {
      useBlob,
      kvEnabled: KV_ENABLED,
      geocode: {
        cacheHits: geocodeStats.cacheHits,
        geocodedThisRequest: geocodeStats.geocoded,
        budgetRemaining: geocodeBudget.remaining,
      },
    },
  });
}
