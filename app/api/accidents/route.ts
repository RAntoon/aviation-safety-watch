import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs"; // must be node for fs

type AnyRow = Record<string, any>;

type ManifestEntry = {
  file: string;
  from?: string;
  to?: string;
  start?: string;
  end?: string;
};

// ---------- helpers ----------

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

function normalizeFileName(name: string): string {
  const s = String(name || "").trim();
  if (!s) return s;
  return s.toLowerCase().endsWith(".json") ? s : `${s}.json`;
}

function readJsonFile(absPath: string) {
  const raw = fs.readFileSync(absPath, "utf8");
  return JSON.parse(raw);
}

function loadManifest(manifestPath: string): ManifestEntry[] {
  const parsed = readJsonFile(manifestPath);

  // Support BOTH:
  // 1) array format: [ { from, to, file }, ... ]
  // 2) object format: { files: [ { start/end or from/to, file }, ... ] }
  if (Array.isArray(parsed)) return parsed as ManifestEntry[];

  if (parsed && typeof parsed === "object") {
    const files = (parsed as any).files;
    if (Array.isArray(files)) return files as ManifestEntry[];
  }

  return [];
}

function getEntryRangeMs(e: ManifestEntry) {
  const a = e.from ?? e.start;
  const b = e.to ?? e.end;
  const startT = a ? Date.parse(a) : NaN;
  const endT = b ? Date.parse(b) : NaN;
  const endInclusive = Number.isFinite(endT) ? endT + 24 * 60 * 60 * 1000 - 1 : NaN;
  return { startT, endInclusive };
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  if (!Number.isFinite(aStart) || !Number.isFinite(aEnd) || !Number.isFinite(bStart) || !Number.isFinite(bEnd)) return true;
  return aStart <= bEnd && bStart <= aEnd;
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

// ---------- handler ----------

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const startStr = searchParams.get("start");
  const endStr = searchParams.get("end");

  const queryStartT = startStr ? Date.parse(startStr) : NaN;
  const queryEndT = endStr ? Date.parse(endStr) : NaN;
  const queryEndInclusive = Number.isFinite(queryEndT) ? queryEndT + 24 * 60 * 60 * 1000 - 1 : NaN;

  const dataDir = path.join(process.cwd(), "data");
  const manifestPath = path.join(dataDir, "manifest.json");

  try {
    if (!fs.existsSync(manifestPath)) {
      return NextResponse.json(
        {
          ok: false,
          error: `manifest.json not found at ${manifestPath}`,
          debug: { manifestPath, dataDir },
          totalRows: 0,
          rowsWithCoords: 0,
          rowsInRange: 0,
          points: [],
        },
        { status: 500 }
      );
    }

    const manifest = loadManifest(manifestPath);

    if (!manifest.length) {
      return NextResponse.json(
        {
          ok: false,
          error: `manifest.json parsed but no entries found. Expect either an array [...] or { "files": [...] }.`,
          debug: { manifestPath },
          totalRows: 0,
          rowsWithCoords: 0,
          rowsInRange: 0,
          points: [],
        },
        { status: 500 }
      );
    }

    // Only load files whose declared range overlaps the query range
    const selected = manifest.filter((e) => {
      const { startT, endInclusive } = getEntryRangeMs(e);
      return rangesOverlap(startT, endInclusive, queryStartT, queryEndInclusive);
    });

    let totalRows = 0;
    let rowsWithCoords = 0;
    let rowsInRange = 0;

    const warnings: any[] = [];
    const points: any[] = [];

    for (const entry of selected) {
      const relName = normalizeFileName(entry.file);
      const filePath = path.join(dataDir, relName);

      if (!fs.existsSync(filePath)) {
        warnings.push({ file: entry.file, normalized: relName, error: "FILE_NOT_FOUND" });
        continue; // don't crash the whole endpoint
      }

      let parsed: any;
      try {
        parsed = readJsonFile(filePath);
      } catch (err: any) {
        warnings.push({ file: relName, error: `JSON_PARSE_FAILED: ${String(err?.message ?? err)}` });
        continue;
      }

      const rows = findFirstArray(parsed);
      totalRows += rows.length;

      for (const row of rows) {
        const eventT = parseDate(row?.cm_eventDate);
        const inRange =
          Number.isFinite(queryStartT) &&
          Number.isFinite(queryEndInclusive) &&
          eventT !== null &&
          eventT >= queryStartT &&
          eventT <= queryEndInclusive;

        if (!inRange) continue;
        rowsInRange++;

        const lat = Number(row?.cm_Latitude);
        const lng = Number(row?.cm_Longitude);
        const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
        if (!hasCoords) continue;
        rowsWithCoords++;

        const ntsbNum = row?.cm_ntsbNum ? String(row.cm_ntsbNum) : undefined;

        // NOTE: NTSB public docket links are currently flaky/dead for many case numbers.
        // We'll still emit a link, but we'll also include the case id (which is the real key).
        const docketUrl = ntsbNum
          ? `https://data.ntsb.gov/Docket/?NTSBNumber=${encodeURIComponent(ntsbNum)}`
          : undefined;

        const narrative =
          row?.prelimNarrative ??
          row?.factualNarrative ??
          row?.analysisNarrative ??
          row?.narrative ??
          undefined;

        const make = row?.cm_vehicles?.[0]?.make ?? row?.make ?? undefined;
        const model = row?.cm_vehicles?.[0]?.model ?? row?.model ?? undefined;

        points.push({
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

          // used by your popup/title
          aircraftType: model ? String(model) : undefined,
          aircraftMake: make ? String(make) : undefined,

          summary: narrative ? String(narrative).slice(0, 240) : undefined,
          narrative: narrative ? String(narrative) : undefined,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      debug: {
        manifestPath,
        selectedFiles: selected.map((e) => normalizeFileName(e.file)),
        warnings,
      },
      totalRows,
      rowsWithCoords,
      rowsInRange,
      points,
    });
  } catch (err: any) {
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
