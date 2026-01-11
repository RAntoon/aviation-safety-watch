import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

type AnyRow = Record<string, any>;

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
  if (parts.length < 2) return null;
  return parts.join(", ").toLowerCase();
}

/* ---------- KV GEO CACHE (READ-ONLY, FAST) ---------- */

const KV_URL = process.env.KV_REST_API_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || "";
const KV_ENABLED = Boolean(KV_URL && KV_TOKEN);

async function kvGetJson<T>(key: string): Promise<T | null> {
  if (!KV_ENABLED) return null;
  const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = await res.json();
  try {
    return data?.result ? JSON.parse(data.result) : null;
  } catch {
    return null;
  }
}

/* ---------- BLOB FETCH (PARALLEL) ---------- */

async function fetchJsonArray(url: string): Promise<AnyRow[]> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch failed ${res.status}`);
  const text = await res.text();
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [];
}

/* ======================= API ======================= */

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
  const manifestPath = path.join(dataDir, "blob-manifest.json");

  if (!fs.existsSync(manifestPath)) {
    return NextResponse.json(
      { ok: false, error: "blob-manifest.json not found", points: [] },
      { status: 500 }
    );
  }

  const manifest: BlobManifestEntry[] = JSON.parse(
    fs.readFileSync(manifestPath, "utf8")
  );

  /* ---------- FILTER BLOBS FIRST (FAST) ---------- */
  const eligibleBlobs = manifest.filter((b) => {
    const from = Date.parse(b.from);
    const to = Date.parse(b.to);
    if (!Number.isFinite(startT) || !Number.isFinite(endInclusive)) return true;
    return !(endInclusive < from || startT > to);
  });

  /* ---------- PARALLEL FETCH ---------- */
  const blobResults = await Promise.allSettled(
    eligibleBlobs.map((b) => fetchJsonArray(b.blobUrl))
  );

  let totalRows = 0;
  let rowsWithCoords = 0;
  let rowsInRange = 0;
  const points: any[] = [];

  for (let i = 0; i < blobResults.length; i++) {
    const result = blobResults[i];
    if (result.status !== "fulfilled") continue;

    const rows = result.value;
    totalRows += rows.length;

    for (const row of rows) {
      const eventT = parseDate(row?.cm_eventDate);
      if (
        eventT === null ||
        !Number.isFinite(startT) ||
        !Number.isFinite(endInclusive) ||
        eventT < startT ||
        eventT > endInclusive
      ) {
        continue;
      }

      rowsInRange++;

      let lat = toNumberOrNaN(row?.cm_Latitude);
      let lng = toNumberOrNaN(row?.cm_Longitude);
      let hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

      if (!hasCoords) {
        const key = locationKey(row);
        if (key) {
          const cached = await kvGetJson<{ lat: number; lng: number }>(`geo:${key}`);
          if (cached) {
            lat = cached.lat;
            lng = cached.lng;
            hasCoords = true;
          }
        }
      }

      if (!hasCoords) continue;
      rowsWithCoords++;

      const ntsbNum = row?.cm_ntsbNum ? String(row.cm_ntsbNum) : undefined;

      const vehicle0 = Array.isArray(row?.cm_vehicles) ? row.cm_vehicles[0] : undefined;

      const tail =
        vehicle0?.registrationNumber ||
        vehicle0?.registration ||
        vehicle0?.tailNumber ||
        undefined;

      const make = vehicle0?.make ? String(vehicle0.make).trim() : "";
      const model = vehicle0?.model ? String(vehicle0.model).trim() : "";
      const fullAircraft =
        [tail, make, model].filter(Boolean).join(" ");

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

        date: row?.cm_eventDate?.slice(0, 10),
        city: row?.cm_city ?? undefined,
        state: row?.cm_state ?? undefined,
        country: row?.cm_country ?? undefined,

        ntsbCaseId: ntsbNum,
        docketUrl: ntsbNum
          ? `https://data.ntsb.gov/Docket/?NTSBNumber=${encodeURIComponent(ntsbNum)}`
          : undefined,

        aircraftType: fullAircraft || undefined,
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
      blobCount: eligibleBlobs.length,
      kvEnabled: KV_ENABLED,
    },
  });
}
