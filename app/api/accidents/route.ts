import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

type AnyRow = Record<string, any>;

type ManifestEntry = {
  from: string;
  to: string;
  file?: string;
  blobUrl?: string;
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

  if (fatalCount > 0 || String(row?.cm_highestInjury || "").toLowerCase() === "fatal")
    return "fatal";

  if (String(row?.cm_eventType || "").toUpperCase() === "ACC") return "accident";
  return "incident";
}

/**
 * IMPORTANT FIX:
 * - Number(null) => 0, which was creating huge clusters at (0,0)
 * - We treat null/undefined/"" as missing instead.
 */
function toNumberOrNaN(v: any): number {
  if (v === null || v === undefined) return NaN;
  if (typeof v === "string" && v.trim() === "") return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

type GeoCacheValue =
  | { lat: number; lng: number }
  | { latitude: number; longitude: number }
  | [number, number];

function readGeoCache(dataDir: string): Record<string, GeoCacheValue> {
  const cachePath = path.join(dataDir, "geocode-cache.json");
  if (!fs.existsSync(cachePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    if (parsed && typeof parsed === "object") return parsed;
    return {};
  } catch {
    return {};
  }
}

function normalizeGeoCacheHit(hit: GeoCacheValue): { lat: number; lng: number } | null {
  if (Array.isArray(hit) && hit.length >= 2) {
    const lat = toNumberOrNaN(hit[0]);
    const lng = toNumberOrNaN(hit[1]);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }
  const anyHit: any = hit as any;
  const lat = toNumberOrNaN(anyHit?.lat ?? anyHit?.latitude);
  const lng = toNumberOrNaN(anyHit?.lng ?? anyHit?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function locationKey(row: AnyRow): string | null {
  const city = row?.cm_city ? String(row.cm_city).trim() : "";
  const state = row?.cm_state ? String(row.cm_state).trim() : "";
  const country = row?.cm_country ? String(row.cm_country).trim() : "";

  // Keep it simple and consistent; city/state is primary, country helps disambiguate.
  const parts = [city, state, country].filter(Boolean);
  if (parts.length < 2) return null; // require at least city + state (or city + country)
  return parts.join(", ").toLowerCase();
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const startStr = searchParams.get("start");
  const endStr = searchParams.get("end");

  const startT = startStr ? Date.parse(startStr) : NaN;
  const endT = endStr ? Date.parse(endStr) : NaN;
  const endInclusive = Number.isFinite(endT)
    ? endT + 24 * 60 * 60 * 1000 - 1
    : NaN;

  const dataDir = path.join(process.cwd(), "data");

  // Manifest logic remains as-is (your project may be using blob-manifest.json in blob mode).
  // This route expects whichever manifest your current code points to.
  const manifestPath = path.join(dataDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return NextResponse.json(
      { ok: false, error: "manifest.json not found", points: [] },
      { status: 500 }
    );
  }

  const manifest: ManifestEntry[] = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  // Load geocode cache once per request (used only when row has no coords)
  const geoCache = readGeoCache(dataDir);

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

    // Local file loading (unchanged)
    const filePath = block.file ? path.join(dataDir, block.file) : "";
    if (!filePath || !fs.existsSync(filePath)) continue;

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

      // --- ONLY CHANGE STARTS HERE ---
      // Coordinates are priority. But treat null/"" as missing (NOT zero).
      let lat = toNumberOrNaN(row?.cm_Latitude);
      let lng = toNumberOrNaN(row?.cm_Longitude);

      let hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

      // If missing coords, try geocode-cache by city/state(/country)
      if (!hasCoords) {
        const key = locationKey(row);
        if (key) {
          const hit = geoCache[key];
          const norm = hit ? normalizeGeoCacheHit(hit) : null;
          if (norm) {
            lat = norm.lat;
            lng = norm.lng;
            hasCoords = true;
          }
        }
      }
      // --- ONLY CHANGE ENDS HERE ---

      if (hasCoords) rowsWithCoords++;
      if (!hasCoords) continue;

      const ntsbNum = row?.cm_ntsbNum ? String(row.cm_ntsbNum) : undefined;

      const vehicle0 = Array.isArray(row?.cm_vehicles) ? row.cm_vehicles[0] : undefined;

      const aircraftType =
        vehicle0?.model
          ? String(vehicle0.model).trim()
          : vehicle0?.make && vehicle0?.model
          ? `${vehicle0.make} ${vehicle0.model}`
          : undefined;

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
  });
}
