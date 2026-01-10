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

type GeoCacheValue =
  | { lat: number; lng: number }
  | { latitude: number; longitude: number }
  | [number, number];

function readGeoCache(dataDir: string): Record<string, GeoCacheValue> {
  const cachePath = path.join(dataDir, "geocode-cache.json");
  if (!fs.existsSync(cachePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
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

  const parts = [city, state, country].filter(Boolean);
  if (parts.length < 2) return null; // need at least city+state (or city+country)
  return parts.join(", ").toLowerCase();
}

async function fetchJsonArray(url: string): Promise<AnyRow[]> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch failed ${res.status} for ${url}`);
  const text = await res.text();
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [];
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const startStr = searchParams.get("start");
  const endStr = searchParams.get("end");

  const q = searchParams.get("q"); // keep if you're using search elsewhere; unused here

  const startT = startStr ? Date.parse(startStr) : NaN;
  const endT = endStr ? Date.parse(endStr) : NaN;
  const endInclusive = Number.isFinite(endT) ? endT + 24 * 60 * 60 * 1000 - 1 : NaN;

  const dataDir = path.join(process.cwd(), "data");

  const useBlob =
    String(process.env.USE_BLOB_DATA || "").toLowerCase() === "true";

  // Use blob-manifest when blob mode is enabled; otherwise fall back to manifest.json (local mode)
  const blobManifestPath = path.join(dataDir, "blob-manifest.json");
  const localManifestPath = path.join(dataDir, "manifest.json");

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

    const manifest: BlobManifestEntry[] = JSON.parse(
      fs.readFileSync(blobManifestPath, "utf8")
    );

    const geoCache = readGeoCache(dataDir);

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
      } catch (e) {
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

        // fallback to cached city/state(/country) if missing coords
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

        if (hasCoords) rowsWithCoords++;
        if (!hasCoords) continue;

        const ntsbNum = row?.cm_ntsbNum ? String(row.cm_ntsbNum) : undefined;

        const vehicle0 = Array.isArray(row?.cm_vehicles)
          ? row.cm_vehicles[0]
          : undefined;

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
      debug: { useBlob, manifestEntries: manifest.length, blocksLoaded },
    });
  }

  // ----- Local mode (unchanged behavior) -----
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

  const manifest: LocalManifestEntry[] = JSON.parse(
    fs.readFileSync(localManifestPath, "utf8")
  );

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

      if (hasCoords) rowsWithCoords++;
      if (!hasCoords) continue;

      const ntsbNum = row?.cm_ntsbNum ? String(row.cm_ntsbNum) : undefined;

      const vehicle0 = Array.isArray(row?.cm_vehicles)
        ? row.cm_vehicles[0]
        : undefined;

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
    debug: { useBlob },
  });
}
