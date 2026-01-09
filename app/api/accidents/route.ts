import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

type AnyRow = Record<string, any>;

type BlobEntry = {
  from: string;     // YYYY-MM-DD
  to: string;       // YYYY-MM-DD
  blobUrl: string;  // public blob url
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

  const dataDir = path.join(process.cwd(), "data");
  const blobManifestPath = path.join(dataDir, "blob-manifest.json");

  if (!fs.existsSync(blobManifestPath)) {
    return NextResponse.json(
      { ok: false, error: "data/blob-manifest.json not found", points: [] },
      { status: 500 }
    );
  }

  let manifest: BlobEntry[] = [];
  try {
    manifest = JSON.parse(fs.readFileSync(blobManifestPath, "utf8"));
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "blob-manifest.json is not valid JSON", detail: String(e?.message ?? e), points: [] },
      { status: 500 }
    );
  }

  if (!Array.isArray(manifest)) {
    return NextResponse.json(
      { ok: false, error: "blob-manifest.json must be a top-level array []", points: [] },
      { status: 500 }
    );
  }

  // figure out which blob files overlap the requested date range
  const blocksToLoad = manifest.filter((b) => {
    const bFrom = Date.parse(b.from);
    const bTo = Date.parse(b.to);
    if (!Number.isFinite(startT) || !Number.isFinite(endInclusive)) return true; // if no params, load all (but UI always sends)
    return !(endInclusive < bFrom || startT > bTo);
  });

  let totalRows = 0;
  let rowsWithCoords = 0;
  let rowsInRange = 0;

  const points: any[] = [];
  const debug: any = {
    manifestEntries: manifest.length,
    blocksLoaded: blocksToLoad.map((b) => ({ from: b.from, to: b.to, label: b.label, blobUrl: b.blobUrl })),
  };

  try {
    for (const block of blocksToLoad) {
      if (!block?.blobUrl) continue;

      const res = await fetch(block.blobUrl, { cache: "no-store" });
      if (!res.ok) {
        return NextResponse.json(
          {
            ok: false,
            error: `Failed to fetch blob: ${res.status} ${res.statusText}`,
            blobUrl: block.blobUrl,
            debug,
            points: [],
          },
          { status: 500 }
        );
      }

      const parsed = await res.json();
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

        const lat = Number(row?.cm_Latitude);
        const lng = Number(row?.cm_Longitude);
        const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
        if (hasCoords) rowsWithCoords++;
        if (!hasCoords) continue;

        const ntsbNum = row?.cm_ntsbNum ? String(row.cm_ntsbNum) : undefined;

        // aircraft type: prefer model, else make+model
        const vehicle0 = Array.isArray(row?.cm_vehicles) ? row.cm_vehicles[0] : undefined;
        const aircraftType =
          vehicle0?.model
            ? String(vehicle0.model).trim()
            : vehicle0?.make && vehicle0?.model
            ? `${vehicle0.make} ${vehicle0.model}`
            : undefined;

        // narrative: keep short preview only (prevents huge popup)
        const narrative =
          row?.prelimNarrative ??
          row?.factualNarrative ??
          row?.analysisNarrative ??
          undefined;

        const preview = narrative ? String(narrative).replace(/\s+/g, " ").trim().slice(0, 260) : undefined;

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

          // NTSB docket links have been flaky; keep the case number and also provide a safer search link
          docketUrl: ntsbNum
            ? `https://data.ntsb.gov/carol-main-public/query-builder?queryId=2&results-page=1&sort-field=cm_eventDate&sort-direction=desc&filters=%5B%7B%22field%22%3A%22cm_ntsbNum%22%2C%22operator%22%3A%22%3D%22%2C%22value%22%3A%22${encodeURIComponent(ntsbNum)}%22%7D%5D`
            : undefined,

          aircraftType,
          summary: preview,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      debug,
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
        debug,
        totalRows,
        rowsWithCoords,
        rowsInRange,
        points: [],
      },
      { status: 500 }
    );
  }
}
