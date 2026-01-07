import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs"; // required for fs on Vercel

type AnyRow = Record<string, any>;

type ManifestEntry = {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  file: string; // filename inside /data
};

function isoDate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function last12MonthsRange() {
  const end = new Date();
  const start = new Date(end);
  start.setFullYear(end.getFullYear() - 1);
  return { start, end };
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

/**
 * Robustly extract rows from many export shapes:
 * - top-level array
 * - object with first array-valued key
 * - numeric-keyed object { "0": {...}, "1": {...} }
 * - double-encoded JSON string containing JSON
 */
function extractRows(parsed: any): AnyRow[] {
  // double-encoded JSON
  if (typeof parsed === "string") {
    const s = parsed.trim();
    if (
      (s.startsWith("[") && s.endsWith("]")) ||
      (s.startsWith("{") && s.endsWith("}"))
    ) {
      try {
        return extractRows(JSON.parse(s));
      } catch {
        return [];
      }
    }
    return [];
  }

  if (Array.isArray(parsed)) return parsed as AnyRow[];

  if (parsed && typeof parsed === "object") {
    // first array-valued property
    for (const k of Object.keys(parsed)) {
      const v = (parsed as any)[k];
      if (Array.isArray(v)) return v as AnyRow[];
    }

    // numeric-keyed object
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

function overlaps(aStart: number, aEndInclusive: number, bStart: number, bEndInclusive: number) {
  return !(bEndInclusive < aStart || bStart > aEndInclusive);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  // ✅ Default to last 12 months if not specified
  const def = last12MonthsRange();
  const startStr = searchParams.get("start") ?? isoDate(def.start);
  const endStr = searchParams.get("end") ?? isoDate(def.end);

  const startT = Date.parse(startStr);
  const endT = Date.parse(endStr);
  const endInclusive = Number.isFinite(endT) ? endT + 24 * 60 * 60 * 1000 - 1 : NaN;

  const manifestPath = path.join(process.cwd(), "data", "manifest.json");
  const manifestExists = fs.existsSync(manifestPath);

  try {
    if (!manifestExists) {
      return NextResponse.json(
        {
          ok: false,
          error: `manifest.json not found at ${manifestPath}`,
          debug: { manifestPath, manifestExists },
          totalRows: 0,
          rowsWithCoords: 0,
          rowsInRange: 0,
          points: [],
        },
        { status: 500 }
      );
    }

    const manifestRaw = fs.readFileSync(manifestPath, "utf8");
    const manifestParsed = JSON.parse(manifestRaw);

    if (!Array.isArray(manifestParsed)) {
      return NextResponse.json(
        {
          ok: false,
          error: `manifest.json must be an array of {from,to,file}`,
          debug: { manifestPath, manifestType: typeof manifestParsed },
          totalRows: 0,
          rowsWithCoords: 0,
          rowsInRange: 0,
          points: [],
        },
        { status: 500 }
      );
    }

    const manifest: ManifestEntry[] = manifestParsed;

    // Determine which blocks overlap requested window
    const wantedEntries: ManifestEntry[] = [];
    for (const entry of manifest) {
      const fileStart = Date.parse(entry.from);
      const fileEnd = Date.parse(entry.to) + 24 * 60 * 60 * 1000 - 1;

      if (!Number.isFinite(fileStart) || !Number.isFinite(fileEnd)) continue;
      if (!Number.isFinite(startT) || !Number.isFinite(endInclusive)) continue;

      if (overlaps(startT, endInclusive, fileStart, fileEnd)) {
        wantedEntries.push(entry);
      }
    }

    // Load rows from overlapping blocks only
    let rows: AnyRow[] = [];
    const loadedFiles: string[] = [];
    const missingFiles: string[] = [];

    for (const entry of wantedEntries) {
      const filePath = path.join(process.cwd(), "data", entry.file);
      if (!fs.existsSync(filePath)) {
        missingFiles.push(entry.file);
        continue;
      }
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw);
      const fileRows = extractRows(parsed);
      rows.push(...fileRows);
      loadedFiles.push(entry.file);
    }

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

        // ✅ Use provided lat/long only (we’ll add city/state geocode fallback next)
        const lat = Number(row?.cm_Latitude);
        const lng = Number(row?.cm_Longitude);
        const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
        if (hasCoords) rowsWithCoords++;

        if (!inRange || !hasCoords) return null;

        const ntsbNum = row?.cm_ntsbNum ? String(row.cm_ntsbNum) : undefined;

        // Note: docket may not be released; we’ll gate this later using cm_docketDate
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
      startStr,
      endStr,
      manifestEntries: manifest.length,
      overlappingBlocks: wantedEntries.length,
      loadedFiles,
      missingFiles,
      detectedRows: rows.length,
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
        totalRows: 0,
        rowsWithCoords: 0,
        rowsInRange: 0,
        points: [],
      },
      { status: 500 }
    );
  }
}
