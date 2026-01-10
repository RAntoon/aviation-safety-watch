import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

type AnyRow = Record<string, any>;

type BlobManifestEntry = {
  from: string;
  to: string;
  url: string; // FULL blob URL
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

async function fetchJsonArray(url: string): Promise<AnyRow[]> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  const text = await res.text();
  // Some exports can start with BOM; strip it
  const cleaned = text.replace(/^\uFEFF/, "");
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) return [];
  return parsed as AnyRow[];
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const startStr = searchParams.get("start");
  const endStr = searchParams.get("end");
  const q = (searchParams.get("q") || "").trim().toLowerCase();

  const startT = startStr ? Date.parse(startStr) : NaN;
  const endT = endStr ? Date.parse(endStr) : NaN;
  const endInclusive = Number.isFinite(endT) ? endT + 24 * 60 * 60 * 1000 - 1 : NaN;

  const dataDir = path.join(process.cwd(), "data");
  const manifestPath = path.join(dataDir, "blob-manifest.json");

  if (!fs.existsSync(manifestPath)) {
    return NextResponse.json(
      { ok: false, error: "blob-manifest.json not found", points: [] },
      { status: 500 }
    );
  }

  let manifest: BlobManifestEntry[] = [];
  try {
    const raw = fs.readFileSync(manifestPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return NextResponse.json(
        { ok: false, error: "blob-manifest.json invalid: must be a JSON array", points: [] },
        { status: 500 }
      );
    }
    manifest = parsed as BlobManifestEntry[];
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: `blob-manifest.json parse error: ${String(e?.message ?? e)}`, points: [] },
      { status: 500 }
    );
  }

  let totalRows = 0;
  let rowsWithCoords = 0;
  let rowsInRange = 0;
  let matched = 0;
  const points: any[] = [];

  const blocksLoaded: string[] = [];

  for (const block of manifest) {
    const blockFrom = Date.parse(block.from);
    const blockTo = Date.parse(block.to);

    // Skip blocks that can't overlap the date range
    if (
      Number.isFinite(startT) &&
      Number.isFinite(endInclusive) &&
      (endInclusive < blockFrom || startT > blockTo)
    ) {
      continue;
    }

    try {
      const rows = await fetchJsonArray(block.url);
      totalRows += rows.length;
      blocksLoaded.push(block.url);

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

        const lat = Number(row?.cm_Latitude);
        const lng = Number(row?.cm_Longitude);
        const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
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

        const tail =
          vehicle0?.registrationNumber
            ? String(vehicle0.registrationNumber).trim()
            : row?.cm_registrationNumber
            ? String(row.cm_registrationNumber).trim()
            : undefined;

        const narrative =
          row?.prelimNarrative ??
          row?.factualNarrative ??
          row?.analysisNarrative ??
          row?.narrative ??
          undefined;

        // Optional keyword filter (single search box)
        if (q) {
          const hay = [
            aircraftType,
            tail,
            row?.cm_city,
            row?.cm_state,
            row?.cm_country,
            row?.cm_ntsbNum,
            narrative,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

          if (!hay.includes(q)) continue;
        }

        matched++;

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

          // keep for now; we’ll fix docket behavior separately
          docketUrl: ntsbNum
            ? `https://data.ntsb.gov/Docket/?NTSBNumber=${encodeURIComponent(ntsbNum)}`
            : undefined,

          aircraftType,
          tail,
          summary: narrative ? String(narrative).slice(0, 240) : undefined,
        });
      }
    } catch (e: any) {
      blocksLoaded.push(`${block.url} (PARSE/FETCH ERROR)`);
      // keep going, so one bad file doesn't kill everything
      continue;
    }
  }

  return NextResponse.json({
    ok: true,
    debug: {
      manifestEntries: manifest.length,
      blocksLoaded,
    },
    totalRows,
    rowsWithCoords,
    rowsInRange,
    matched,
    points,
  });
}
