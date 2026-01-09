import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

type AnyRow = Record<string, any>;
type ManifestEntry = { from: string; to: string; file: string };

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

function firstParagraph(text: string, maxChars = 320) {
  const cleaned = String(text).replace(/\r/g, "");
  const para = cleaned.split("\n\n")[0]?.trim() || cleaned.trim();
  return para.length > maxChars ? para.slice(0, maxChars).trimEnd() + "…" : para;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const startStr = searchParams.get("start");
  const endStr = searchParams.get("end");
  const q = (searchParams.get("q") || "").trim();

  const startT = startStr ? Date.parse(startStr) : NaN;
  const endT = endStr ? Date.parse(endStr) : NaN;
  const endInclusive = Number.isFinite(endT) ? endT + 24 * 60 * 60 * 1000 - 1 : NaN;

  const dataDir = path.join(process.cwd(), "data");
  const manifestPath = path.join(dataDir, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    return NextResponse.json({ ok: false, error: "manifest.json not found", points: [] }, { status: 500 });
  }

  let manifest: ManifestEntry[] = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (!Array.isArray(parsed)) {
      return NextResponse.json(
        { ok: false, error: "manifest.json invalid: must be a JSON array", points: [] },
        { status: 500 }
      );
    }
    manifest = parsed as ManifestEntry[];
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: `manifest.json parse error: ${String(e?.message ?? e)}`, points: [] },
      { status: 500 }
    );
  }

  const base = (process.env.BLOB_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  if (!base) {
    return NextResponse.json(
      { ok: false, error: "Missing env var BLOB_PUBLIC_BASE_URL", points: [] },
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

    if (Number.isFinite(startT) && Number.isFinite(endInclusive) && (endInclusive < blockFrom || startT > blockTo)) {
      continue;
    }

    const url = `${base}/${encodeURIComponent(block.file)}`;

    let text = "";
    try {
      const res = await fetch(url, { cache: "no-store" });
      text = await res.text();

      if (!res.ok) {
        blocksLoaded.push(`${block.file} (HTTP ${res.status})`);
        continue;
      }

      let rows: AnyRow[] = [];
      try {
        const parsed = JSON.parse(text);
        rows = Array.isArray(parsed) ? parsed : [];
      } catch {
        // Show you the first chunk so you can see what the blob is returning (HTML? AccessDenied?)
        const head = text.slice(0, 200).replace(/\s+/g, " ");
        blocksLoaded.push(`${block.file} (PARSE ERROR: starts "${head}")`);
        continue;
      }

      blocksLoaded.push(block.file);
      totalRows += rows.length;

      for (const row of rows) {
        const eventT = parseDate(row?.cm_eventDate);
        const inRange =
          eventT !== null &&
          Number.isFinite(startT) &&
          Number.isFinite(endInclusive) &&
          eventT >= startT &&
          eventT <= endInclusive;

        if (!inRange) continue;
        rowsInRange++;

        const lat = Number(row?.cm_Latitude);
        const lng = Number(row?.cm_Longitude);
        const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
        if (!hasCoords) continue;
        rowsWithCoords++;

        const ntsbNum = row?.cm_ntsbNum ? String(row.cm_ntsbNum) : undefined;

        const vehicle0 = Array.isArray(row?.cm_vehicles) ? row.cm_vehicles[0] : undefined;
        const aircraftType = vehicle0?.model ? String(vehicle0.model).trim() : undefined;
        const tail = vehicle0?.registrationNumber ? String(vehicle0.registrationNumber).trim() : undefined;
        const operator = row?.operatorName ? String(row.operatorName).trim() : undefined;

        const narrative =
          row?.prelimNarrative ??
          row?.factualNarrative ??
          row?.analysisNarrative ??
          undefined;

        // simple single search field
        if (q) {
          const hay = [
            aircraftType,
            tail,
            operator,
            ntsbNum,
            row?.cm_city,
            row?.cm_state,
            row?.cm_country,
            narrative ? firstParagraph(String(narrative), 800) : undefined
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

          if (!hay.includes(q.toLowerCase())) continue;
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
          docketUrl: ntsbNum ? `https://www.ntsb.gov/Pages/investigations.aspx?ntsbno=${encodeURIComponent(ntsbNum)}` : undefined,

          aircraftType,
          tail,
          operator,
          summary: narrative ? firstParagraph(String(narrative), 360) : undefined
        });
      }
    } catch (e: any) {
      blocksLoaded.push(`${block.file} (FETCH ERROR: ${String(e?.message ?? e)})`);
      continue;
    }
  }

  return NextResponse.json({
    ok: true,
    debug: {
      manifestEntries: manifest.length,
      base,
      blocksLoaded
    },
    totalRows,
    rowsWithCoords,
    rowsInRange,
    matched,
    points
  });
}
