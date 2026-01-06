import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs"; // must be node for fs

type AnyRow = Record<string, any>;

function parseDate(value: any): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

function last12MonthsRange() {
  const end = new Date();
  const start = new Date(end);
  start.setFullYear(end.getFullYear() - 1);
  return { start, end };
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

// ✅ More robust than your current findFirstArray():
// - handles top-level array
// - handles object with nested array
// - handles numeric-keyed object: { "0": {...}, "1": {...} }
// - handles double-encoded JSON strings
function extractRows(parsed: any): AnyRow[] {
  // double-encoded JSON: parsed is a string containing JSON
  if (typeof parsed === "string") {
    const s = parsed.trim();
    if ((s.startsWith("[") && s.endsWith("]")) || (s.startsWith("{") && s.endsWith("}"))) {
      try {
        return extractRows(JSON.parse(s));
      } catch {
        return [];
      }
    }
    return [];
  }

  // top-level array
  if (Array.isArray(parsed)) return parsed as AnyRow[];

  // object cases
  if (parsed && typeof parsed === "object") {
    // 1) first array-valued property
    for (const k of Object.keys(parsed)) {
      const v = (parsed as any)[k];
      if (Array.isArray(v)) return v as AnyRow[];
    }

    // 2) numeric-keyed object like { "0": {...}, "1": {...} }
    const keys = Object.keys(parsed);
    if (keys.length > 0 && keys.every((k) => /^\d+$/.test(k))) {
      const values = keys
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => (parsed as any)[k]);
      if (values.every((v) => v && typeof v === "object" && !Array.isArray(v))) {
        return values as AnyRow[];
      }
    }
  }

  return [];
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  // ✅ Default to last 12 months if params are missing
  const def = last12MonthsRange();
  const startStr = searchParams.get("start") ?? def.start.toISOString().slice(0, 10);
  const endStr = searchParams.get("end") ?? def.end.toISOString().slice(0, 10);

  const startT = Date.parse(startStr);
  const endT = Date.parse(endStr);
  const endInclusive = Number.isFinite(endT) ? endT + 24 * 60 * 60 * 1000 - 1 : NaN;

  const dataPath = path.join(process.cwd(), "data", "accidents.json");
  const exists = fs.existsSync(dataPath);

  try {
    if (!exists) {
      return NextResponse.json(
        {
          ok: false,
          error: `File not found: ${dataPath}`,
          debug: { dataPath, exists },
          totalRows: 0,
          rowsWithCoords: 0,
          rowsInRange: 0,
          points: [],
        },
        { status: 500 }
      );
    }

    const raw = fs.readFileSync(dataPath, "utf8");
    const fileBytes = Buffer.byteLength(raw, "utf8");
    const head = raw.slice(0, 200).replace(/\s+/g, " ").trim();

    const parsed = JSON.parse(raw);
    const rows = extractRows(parsed);

    let rowsWithCoords = 0;
    let rowsInRange = 0;

    const points = rows
      .map((row: AnyRow) => {
        const eventT = parseDate(row?.cm_eventDate);
        const inRange =
          Number.isFinite(startT) &&
          Number.isFinite(endInclusive) &&
          eventT !== null &&
          eventT >= startT &&
          eventT <= endInclusive;

        if (inRange) rowsInRange++;

        // ✅ Use provided lat/long ONLY (we’ll add city/state geocode next)
        const lat = Number(row?.cm_Latitude);
        const lng = Number(row?.cm_Longitude);
        const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
        if (hasCoords) rowsWithCoords++;

        if (!inRange || !hasCoords) return null;

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
        };
      })
      .filter(Boolean);

    const debug = {
      dataPath,
      exists,
      fileBytes,
      rawHead: head,
      parsedType: Array.isArray(parsed) ? "array" : typeof parsed,
      topLevelKeys:
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? Object.keys(parsed).slice(0, 30)
          : [],
      detectedRows: rows.length,
      sampleRowKeys: rows[0] ? Object.keys(rows[0]).slice(0, 40) : [],
      startStr,
      endStr,
      rowsInRange,
      rowsWithCoords,
      points: points.length,
    };

    console.log("[/api/accidents] debug:", debug);

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
