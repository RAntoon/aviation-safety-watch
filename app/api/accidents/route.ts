import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

type AnyRow = Record<string, any>;

type ManifestEntry = {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  file: string; // filename label (for debug)
  url: string;  // FULL https://.... blob URL
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

function normalize(s: any) {
  return String(s ?? "").toLowerCase().trim();
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const startStr = searchParams.get("start");
  const endStr = searchParams.get("end");
  const q = searchParams.get("q") || "";

  const startT = startStr ? Date.parse(startStr) : NaN;
  const endT = endStr ? Date.parse(endStr) : NaN;
  const endInclusive = Number.isFinite(endT) ? endT + 24 * 60 * 60 * 1000 - 1 : NaN;

  const dataDir = path.join(process.cwd(), "data");
  const manifestPath = path.join(dataDir, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    return NextResponse.json(
      { ok: false, error: "manifest.json not found (data/manifest.json)", points: [] },
      { status: 500 }
    );
  }

  let manifestRaw: any;
  try {
    manifestRaw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: `manifest.json invalid JSON: ${String(e?.message ?? e)}`, points: [] },
      { status: 500 }
    );
  }

  if (!Array.isArray(manifestRaw)) {
    return NextResponse.json(
      { ok: false, error: "manifest.json invalid: manifest.json must be a JSON array", points: [] },
      { status: 500 }
    );
  }

  const manifest: ManifestEntry[] = manifestRaw;

  const blocksLoaded: string[] = [];
  let totalRows = 0;
  let rowsWithCoords = 0;
  let rowsInRange = 0;
  let matched = 0;

  const points: any[] = [];
  const nq = normalize(q);

  // Load only blocks that overlap the date range
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

    if (!block?.url) continue;

    // Fetch JSON from Blob URL
    let rows: AnyRow[] = [];
    try {
      const res = await fetch(block.url, { cache: "no-store" });
      if (!res.ok) {
        // Skip but record for debug
        blocksLoaded.push(`${block.file} (FETCH ${res.status})`);
        continue;
      }

      const parsed = await res.json();
      rows = Array.isArray(parsed) ? parsed : [];
      blocksLoaded.push(`${block.file} (${rows.length})`);
      totalRows += rows.length;
    } catch (e: any) {
      blocksLoaded.push(`${block.file} (PARSE ERROR)`);
      continue;
    }

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

      // coords
      const lat = Number(row?.cm_Latitude);
      const lng = Number(row?.cm_Longitude);
      const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
      if (hasCoords) rowsWithCoords++;
      if (!hasCoords) continue;

      // fields for searching
      const ntsbNum = row?.cm_ntsbNum ? String(row.cm_ntsbNum) : "";
      const city = row?.cm_city ? String(row.cm_city) : "";
      const state = row?.cm_state ? String(row.cm_state) : "";
      const country = row?.cm_country ? String(row.cm_country) : "";

      const vehicle0 = Array.isArray(row?.cm_vehicles) ? row.cm_vehicles[0] : undefined;
      const make = vehicle0?.make ? String(vehicle0.make) : "";
      const model = vehicle0?.model ? String(vehicle0.model) : "";
      const reg = vehicle0?.registrationNumber ? String(vehicle0.registrationNumber) : "";
      const operator = vehicle0?.operatorName ? String(vehicle0.operatorName) : "";

      const narrative =
        row?.prelimNarrative ??
        row?.factualNarrative ??
        row?.analysisNarrative ??
        undefined;

      // simple single-box search (aircraft/type/tail/operator/ntsb/city/state/country/narrative)
      if (nq) {
        const hay = normalize(
          [
            ntsbNum,
            city,
            state,
            country,
            make,
            model,
            reg,
            operator,
            narrative ? String(narrative) : "",
          ].join(" ")
        );
        if (!hay.includes(nq)) continue;
      }

      matched++;

      const aircraftType = model ? model.trim() : (make && model ? `${make} ${model}` : undefined);

      // short summary only (high level)
      const summary = narrative ? String(narrative).slice(0, 320) : undefined;

      points.push({
        id: String(row?.cm_mkey ?? ntsbNum ?? `${lat},${lng}`),
        lat,
        lng,
        kind: kindFor(row),

        date: row?.cm_eventDate ? String(row.cm_eventDate).slice(0, 10) : undefined,
        city: city || undefined,
        state: state || undefined,
        country: country || undefined,

        ntsbCaseId: ntsbNum || undefined,
        docketUrl: ntsbNum
          ? `https://data.ntsb.gov/Docket/?NTSBNumber=${encodeURIComponent(ntsbNum)}`
          : undefined,

        aircraftType,
        tailNumber: reg || undefined,
        operatorName: operator || undefined,

        summary,
      });
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
