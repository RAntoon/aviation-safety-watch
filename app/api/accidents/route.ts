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

function locationKey(row: AnyRow): string | null {
  const city = row?.cm_city?.trim();
  const state = row?.cm_state?.trim();
  const country = row?.cm_country?.trim();
  const parts = [city, state, country].filter(Boolean);
  return parts.length >= 2 ? parts.join(", ").toLowerCase() : null;
}

function locationLabel(row: AnyRow): string | null {
  const city = row?.cm_city?.trim();
  const state = row?.cm_state?.trim();
  const country = row?.cm_country?.trim();
  const parts = [city, state, country].filter(Boolean);
  return parts.length >= 2 ? parts.join(", ") : null;
}

async function fetchJsonArray(url: string): Promise<AnyRow[]> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch failed ${res.status}`);
  const parsed = JSON.parse(await res.text());
  return Array.isArray(parsed) ? parsed : [];
}

/* =========================
   KV Cache (Response Cache)
========================= */

const KV_URL = process.env.KV_REST_API_URL!;
const KV_TOKEN = process.env.KV_REST_API_TOKEN!;
const CACHE_TTL_SECONDS = 60 * 60 * 24; // 24 hours

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

async function kvSet(key: string, value: any) {
  const payload = encodeURIComponent(JSON.stringify(value));
  const url = `${KV_URL}/setex/${encodeURIComponent(key)}/${CACHE_TTL_SECONDS}/${payload}`;
  await fetch(url, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    cache: "no-store",
  });
}

/* =========================
   API Route
========================= */

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const startStr = searchParams.get("start") ?? "";
  const endStr = searchParams.get("end") ?? "";

  const cacheKey = `accidents:v1:${startStr}:${endStr}`;

  // 🔥 CACHE HIT
  const cached = await kvGet<any>(cacheKey);
  if (cached) {
    return NextResponse.json({ ...cached, cached: true });
  }

  const startT = Date.parse(startStr);
  const endT = Date.parse(endStr);
  const endInclusive = endT + 24 * 60 * 60 * 1000 - 1;

  const dataDir = path.join(process.cwd(), "data");
  const manifestPath = path.join(dataDir, "blob-manifest.json");

  const manifest: BlobManifestEntry[] = JSON.parse(
    fs.readFileSync(manifestPath, "utf8")
  );

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

      let lat = toNumberOrNaN(row?.cm_Latitude);
      let lng = toNumberOrNaN(row?.cm_Longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      rowsWithCoords++;

      const vehicle = row?.cm_vehicles?.[0];

      const tail = vehicle?.registrationNumber?.trim();
      const make = vehicle?.make?.trim();
      const model = vehicle?.model?.trim();

      const aircraftType =
        [tail, make, model].filter(Boolean).join(" ");

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
        summary:
          row?.prelimNarrative ??
          row?.factualNarrative ??
          row?.analysisNarrative,
      });
    }
  }

  const response = {
    ok: true,
    totalRows,
    rowsWithCoords,
    rowsInRange,
    points,
  };

  // 💾 CACHE STORE
  await kvSet(cacheKey, response);

  return NextResponse.json({ ...response, cached: false });
}
