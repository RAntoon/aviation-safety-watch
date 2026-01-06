import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs"; // must be node for fs

type AnyRow = Record<string, any>;

function findFirstArray(value: any): AnyRow[] {
  if (Array.isArray(value)) return value as AnyRow[];

  // If it's an object, look for the first array value (common for exported JSON)
  if (value && typeof value === "object") {
    for (const k of Object.keys(value)) {
      const v = (value as any)[k];
      if (Array.isArray(v)) return v as AnyRow[];
    }
  }

  return [];
}

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

  if (fatalCount > 0 || String(row?.cm_highestInjury || "").toLowerCase() === "fatal") return "fatal";
  if (String(row?.cm_eventType || "").toUpperCase() === "ACC") return "accident";
  return "incident";
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const startStr = searchParams.get("start");
  const endStr = searchParams.get("end");

  const startT = startStr ? Date.parse(startStr) : NaN;
  const endT = endStr ? Date.parse(endStr) : NaN;
  const endInclusive = Number.isFinite(endT) ? endT + 24 * 60 * 60 * 1000 - 1 : NaN;

  const dataPath = path.join(process.cwd(), "data", "accidents.json");
  const exists = fs.existsSync(dataPath);

  try {
    if (!exists) {
      return NextResponse.json(
        { ok: false, error: `File not found: ${dataPath}`, debug: { dataPath, exists }, totalRows: 0, rowsWithCoords: 0, rowsInRange: 0, points: [] },
        { status: 500 }
      );
    }

    const raw = fs.readFileSync(dataPath, "utf8");
    const parsed = JSON.parse(raw);

    const rows = findFirstArray(parsed);

    const debug = {
      dataPath,
      exists,
      parsedType: Array.isArray(parsed) ? "array" : typeof parsed,
      topLevelKeys: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.keys(parsed).slice(0, 30) : [],
      detectedArrayLength: rows.length,
    };

    let rowsWithCoords = 0;
    let rowsInRange = 0;

    const points = rows
      .map((row: AnyRow) => {
        const lat = Number(row?.cm_Latitude);
        const lng = Number(row?.cm_Longitude);
        const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
        if (hasCoords) rowsWithCoords++;

        const eventT = parseDate(row?.cm_eventDate);
        const inRange =
          Number.isFinite(startT) &&
          Number.isFinite(endInclusive) &&
          eventT !== null &&
          eventT >= startT &&
          eventT <= endInclusive;

        if (inRange) rowsInRange++;

        if (!hasCoords || !inRange) return null;

        const ntsbNum = row?.cm_ntsbNum ? String(row.cm_ntsbNum) : undefined;
        const docketUrl = ntsbNum
          ? `https://data.ntsb.gov/Docket/?NTSBNumber=${encodeURIComponent(ntsbNum)}`
          : undefined;

        const narrative =
          row?.prelimNarrative ??
          row?.factualNarrative ??
          row?.analysisNarrative ??
          row?.narrative ??
          undefined;

        return {
          id: String(row?.cm_mkey ?? ntsbNum ?? `${lat},${lng},${row?.cm_eventDate ?? ""}`),
          lat,
          lng,
          kind: kindFor(row),

          date: row?.cm_eventDate ? String(row.cm_eventDate).slice(0, 10) : undefined,
          city: row?.cm_city ?? undefined,
          state: row?.cm_state ?? undefined,
          country: row?.cm_country ?? undefined,

          ntsbCaseId: ntsbNum,
          docketUrl,
          summary: narrative ? String(narrative).slice(0, 240) : undefined,
          narrative: narrative ? String(narrative) : undefined,
          raw: row,
        };
      })
      .filter(Boolean);

    console.log("[/api/accidents] debug:", { ...debug, rowsWithCoords, rowsInRange, points: points.length });

    return NextResponse.json({
      ok: true,
      debug,
      totalRows: rows.length,
      rowsWithCoords,
      rowsInRange,
      points,
    });
  } catch (err: any) {
    console.error("[/api/accidents] error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: String(err?.message ?? err),
        debug: { dataPath, exists },
        totalRows: 0,
        rowsWithCoords: 0,
        rowsInRange: 0,
        points: [],
      },
      { status: 500 }
    );
  }
}
