import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

type AnyRow = Record<string, any>;

type LocalManifestEntry = {
  from: string;
  to: string;
  file: string;
};

type BlobManifestEntry = {
  from: string;
  to: string;
  blobUrl: string; // full URL
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

function normalizeSearchTerm(raw: string | null): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  return s.toLowerCase();
}

function buildSearchHaystack(row: AnyRow): string {
  const ntsbNum = row?.cm_ntsbNum ? String(row.cm_ntsbNum) : "";
  const tail = row?.cm_registration ?? row?.registration ?? row?.tailNumber ?? "";
  const city = row?.cm_city ?? "";
  const state = row?.cm_state ?? "";
  const country = row?.cm_country ?? "";

  const vehicle0 = Array.isArray(row?.cm_vehicles) ? row.cm_vehicles[0] : undefined;
  const make = vehicle0?.make ? String(vehicle0.make) : "";
  const model = vehicle0?.model ? String(vehicle0.model) : "";
  const operator =
    vehicle0?.operator ? String(vehicle0.operator) :
    row?.cm_operator ? String(row.cm_operator) :
    "";

  const narrative =
    row?.prelimNarrative ??
    row?.factualNarrative ??
    row?.analysisNarrative ??
    "";

  return [
    ntsbNum,
    tail,
    city,
    state,
    country,
    make,
    model,
    operator,
    narrative,
  ]
    .join(" ")
    .toLowerCase();
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const startStr = searchParams.get("start");
  const endStr = searchParams.get("end");
  const q = normalizeSearchTerm(searchParams.get("q"));

  const startT = startStr ? Date.parse(startStr) : NaN;
  const endT = endStr ? Date.parse(endStr) : NaN;
  const endInclusive = Number.isFinite(endT) ? endT + 24 * 60 * 60 * 1000 - 1 : NaN;

  const useBlob =
    String(process.env.USE_BLOB_DATA || "").toLowerCase() === "true" ||
    String(process.env.USE_BLOB_DATA || "") === "1";

  const dataDir = path.join(process.cwd(), "data");
  const localManifestPath = path.join(dataDir, "manifest.json");
  const blobManifestPath = path.join(dataDir, "blob-manifest.json");

  const debug: any = {
    useBlob,
    start: startStr,
    end: endStr,
    q,
    manifestPath: useBlob ? "data/blob-manifest.json" : "data/manifest.json",
    manifestEntries: 0,
    blocksLoaded: [] as string[],
  };

  if (useBlob) {
    if (!fs.existsSync(blobManifestPath)) {
      return NextResponse.json(
        { ok: false, error: "blob-manifest.json not found", points: [], debug },
        { status: 500 }
      );
    }

    let manifest: BlobManifestEntry[] = [];
    try {
      const raw = fs.readFileSync(blobManifestPath, "utf8");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return NextResponse.json(
          { ok: false, error: "blob-manifest.json must be a JSON array", points: [], debug },
          { status: 500 }
        );
      }
      manifest = parsed;
    } catch (e: any) {
      return NextResponse.json(
        { ok: false, error: `blob-manifest.json parse error: ${String(e?.message || e)}`, points: [], debug },
        { status: 500 }
      );
    }

    debug.manifestEntries = manifest.length;

    let totalRows = 0;
    let rowsWithCoords = 0;
    let rowsInRange = 0;
    let matched = 0;
    const points: any[] = [];

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

      const url = block.blobUrl;

      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) {
          debug.blocksLoaded.push(`${url} (HTTP ${res.status})`);
          continue;
        }

        const text = await res.text();

        let parsed: any;
        try {
          parsed = JSON.parse(text);
        } catch {
          debug.blocksLoaded.push(`${url} (PARSE ERROR)`);
          continue;
        }

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

          // optional search filter
          if (q) {
            const hay = buildSearchHaystack(row);
            if (!hay.includes(q)) continue;
            matched++;
          }

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

            date: row?.cm_eventDate ? String(row.cm_eventDate).slice(0, 10) : undefined,
            city: row?.cm_city ?? undefined,
            state: row?.cm_state ?? undefined,
            country: row?.cm_country ?? undefined,

            ntsbCaseId: ntsbNum,
            docketUrl: ntsbNum
              ? `https://data.ntsb.gov/Docket/?NTSBNumber=${encodeURIComponent(ntsbNum)}`
              : undefined,

            aircraftType,
            summary: narrative ? String(narrative).slice(0, 240) : undefined,
          });
        }

        debug.blocksLoaded.push(`${url} (OK rows=${rows.length})`);
      } catch (e: any) {
        debug.blocksLoaded.push(`${url} (FETCH ERROR: ${String(e?.message || e)})`);
      }
    }

    return NextResponse.json({
      ok: true,
      totalRows,
      rowsWithCoords,
      rowsInRange,
      matched: q ? matched : undefined,
      points,
      debug,
    });
  }

  // ---- fallback: local files mode ----
  if (!fs.existsSync(localManifestPath)) {
    return NextResponse.json(
      { ok: false, error: "manifest.json not found", points: [], debug },
      { status: 500 }
    );
  }

  const manifest: LocalManifestEntry[] = JSON.parse(fs.readFileSync(localManifestPath, "utf8"));
  debug.manifestEntries = manifest.length;

  // (You can keep your local logic here if you still want fallback)
  return NextResponse.json({ ok: false, error: "Local mode not configured", points: [], debug }, { status: 500 });
}
