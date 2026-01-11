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

/** --------- NEW: aircraft helpers (tail + full make/model/series) --------- */

function cleanStr(v: any): string {
  return String(v ?? "").trim();
}

function normalizeTail(raw: string): string | undefined {
  const s = cleanStr(raw);
  if (!s) return undefined;
  // keep as-is but normalize whitespace and casing
  // US N-numbers are usually uppercase; other countries vary but uppercase is fine
  return s.replace(/\s+/g, "").toUpperCase();
}

function pickFirstNonEmpty(obj: any, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj?.[k];
    if (v === null || v === undefined) continue;
    const s = cleanStr(v);
    if (s) return s;
  }
  return undefined;
}

/**
 * Tail numbers can appear under different field names depending on export shape.
 * We check vehicle first (most reliable), then row-level fallbacks.
 */
function tailFor(row: AnyRow, vehicle0: any): string | undefined {
  const vehicleTailRaw =
    pickFirstNonEmpty(vehicle0, [
      "registrationNumber",
      "registration",
      "tailNumber",
      "tail_number",
      "nNumber",
      "n_number",
      "aircraftRegistration",
      "aircraftReg",
      "aircraftRegNo",
      "regNo",
      "registrationNo",
      "identification",
      "ident",
      "serialOrRegistration", // seen in some datasets
    ]) ?? undefined;

  const rowTailRaw =
    pickFirstNonEmpty(row, [
      "cm_registrationNumber",
      "cm_tailNumber",
      "cm_nNumber",
      "cm_aircraftReg",
      "cm_aircraftRegNo",
      "cm_aircraftRegistration",
      "cm_identification",
      "aircraftRegistration",
      "registrationNumber",
      "tailNumber",
    ]) ?? undefined;

  return normalizeTail(vehicleTailRaw ?? rowTailRaw ?? "");
}

/**
 * Build a full "Make Model Series" string.
 * Your old code returned just model when present, which is why you saw "8".
 */
function fullAircraftType(vehicle0: any): string | undefined {
  if (!vehicle0) return undefined;

  const make =
    pickFirstNonEmpty(vehicle0, ["make", "manufacturer", "mfr", "aircraftMake"]) ?? "";
  const model =
    pickFirstNonEmpty(vehicle0, ["model", "aircraftModel", "modelName", "aircraftModelName"]) ?? "";
  const series =
    pickFirstNonEmpty(vehicle0, ["series", "modelSeries", "aircraftSeries", "variant"]) ?? "";

  // Join only distinct non-empty parts
  const parts = [make, model, series].map((x) => cleanStr(x)).filter(Boolean);

  // De-dupe obvious repeats (e.g., "CIRRUS" repeated)
  const deduped: string[] = [];
  for (const p of parts) {
    const up = p.toUpperCase();
    if (!deduped.some((d) => d.toUpperCase() === up)) deduped.push(p);
  }

  const out = deduped.join(" ").replace(/\s+/g, " ").trim();
  return out ? out : undefined;
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

        const aircraftType = fullAircraftType(vehicle0);

        const tailNumber = tailFor(row, vehicle0);

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

          tailNumber,      // ✅ NEW
          aircraftType,    // ✅ Now “Make Model Series”, not “8”
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

  // ----- Local mode (kept, but also outputs tail + full type) -----
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

      const aircraftType = fullAircraftType(vehicle0);
      const tailNumber = tailFor(row, vehicle0);

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

        tailNumber,      // ✅ NEW
        aircraftType,    // ✅ full make/model/series
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
