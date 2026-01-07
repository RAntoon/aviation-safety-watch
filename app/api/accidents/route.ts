import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

type AnyRow = Record<string, any>;

type ManifestEntry = {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  file: string; // filename in /data (must match exactly)
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

function norm(s: any): string {
  return String(s ?? "").toLowerCase().trim();
}

function matchesQuery(q: string, haystackParts: any[]): boolean {
  if (!q) return true;
  const h = haystackParts.map(norm).filter(Boolean).join(" | ");
  return h.includes(q);
}

// ✅ Handles either:
//  - top-level array: [ ... ]
//  - wrapped object: { results: [ ... ] } or similar
function findFirstArray(value: any): AnyRow[] {
  if (Array.isArray(value)) return value as AnyRow[];

  if (value && typeof value === "object") {
    for (const k of Object.keys(value)) {
      const v = (value as any)[k];
      if (Array.isArray(v)) return v as AnyRow[];
    }
  }

  return [];
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const startStr = searchParams.get("start");
  const endStr = searchParams.get("end");
  const qRaw = searchParams.get("q") ?? "";
  const q = norm(qRaw);

  const startT = startStr ? Date.parse(startStr) : NaN;
  const endT = endStr ? Date.parse(endStr) : NaN;
  const endInclusive = Number.isFinite(endT) ? endT + 24 * 60 * 60 * 1000 - 1 : NaN;

  const dataDir = path.join(process.cwd(), "data");
  const manifestPath = path.join(dataDir, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    return NextResponse.json(
      { ok: false, error: "manifest.json not found", points: [] },
      { status: 500 }
    );
  }

  let manifest: ManifestEntry[] = [];
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (!Array.isArray(manifest)) throw new Error("manifest.json must be a JSON array");
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: `manifest.json invalid: ${String(e?.message ?? e)}`, points: [] },
      { status: 500 }
    );
  }

  let totalRows = 0;
  let rowsWithCoords = 0;
  let rowsInRange = 0;
  let rowsMatchedQuery = 0;

  const points: any[] = [];
  const blockErrors: any[] = [];

  for (const block of manifest) {
    const blockFrom = Date.parse(block.from);
    const blockTo = Date.parse(block.to);

    // skip blocks that cannot intersect date range
    if (
      Number.isFinite(startT) &&
      Number.isFinite(endInclusive) &&
      (endInclusive < blockFrom || startT > blockTo)
    ) {
      continue;
    }

    const filePath = path.join(dataDir, block.file);

    if (!fs.existsSync(filePath)) {
      blockErrors.push({ file: block.file, error: "file not found", filePath });
      continue;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (e: any) {
      blockErrors.push({ file: block.file, error: `JSON parse failed: ${String(e?.message ?? e)}` });
      continue; // ✅ do not crash whole request
    }

    const rows: AnyRow[] = findFirstArray(parsed);
    if (!rows.length) {
      blockErrors.push({
        file: block.file,
        error: "No array found in JSON (expected top-level array or an object containing an array)",
        parsedType: Array.isArray(parsed) ? "array" : typeof parsed,
        topLevelKeys:
          parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? Object.keys(parsed).slice(0, 30)
            : [],
      });
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
          : vehicle0?.make
          ? String(vehicle0.make).trim()
          : undefined;

      const tailNumber = vehicle0?.registrationNumber
        ? String(vehicle0.registrationNumber).trim()
        : undefined;

      const operatorName = vehicle0?.operatorName
        ? String(vehicle0.operatorName).trim()
        : undefined;

      const narrative =
        row?.prelimNarrative ??
        row?.factualNarrative ??
        row?.analysisNarrative ??
        row?.narrative ??
        undefined;

      const okQuery = matchesQuery(q, [
        ntsbNum,
        aircraftType,
        tailNumber,
        operatorName,
        row?.cm_city,
        row?.cm_state,
        row?.cm_country,
        narrative,
        vehicle0?.make,
        vehicle0?.model,
      ]);

      if (!okQuery) continue;
      rowsMatchedQuery++;

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
        tailNumber,
        operatorName,

        summary: narrative ? String(narrative).slice(0, 240) : undefined,
        narrative: narrative ? String(narrative) : undefined,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    query: qRaw,
    totalRows,
    rowsInRange,
    rowsWithCoords,
    rowsMatchedQuery,
    points,
    blockErrors, // ✅ this will tell you exactly what's wrong
  });
}
