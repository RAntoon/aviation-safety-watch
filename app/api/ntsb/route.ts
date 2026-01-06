import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

type RawEvent = any;

type PointKind = "fatal" | "accident" | "incident";

function parseDateSafe(v: any): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function isoDateOnlyUTC(d: Date) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function num(v: any): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function pickLatLng(e: RawEvent): { lat: number; lng: number } | null {
  // Prefer NTSB-style fields
  const lat1 = num(e?.cm_Latitude);
  const lng1 = num(e?.cm_Longitude);
  if (lat1 != null && lng1 != null) return { lat: lat1, lng: lng1 };

  // Common alternates
  const lat2 = num(e?.Latitude ?? e?.latitude ?? e?.lat);
  const lng2 = num(e?.Longitude ?? e?.longitude ?? e?.lng ?? e?.lon);
  if (lat2 != null && lng2 != null) return { lat: lat2, lng: lng2 };

  // Sometimes nested
  const lat3 = num(e?.location?.lat ?? e?.location?.latitude);
  const lng3 = num(e?.location?.lng ?? e?.location?.longitude);
  if (lat3 != null && lng3 != null) return { lat: lat3, lng: lng3 };

  return null;
}

function pickEventDate(e: RawEvent): Date | null {
  return (
    parseDateSafe(e?.cm_eventDate) ||
    parseDateSafe(e?.eventDate) ||
    parseDateSafe(e?.date) ||
    parseDateSafe(e?.EventDate) ||
    null
  );
}

function toKind(e: RawEvent): PointKind {
  const fatalCount = Number(e?.cm_fatalInjuryCount ?? e?.fatalInjuryCount ?? 0);
  const highest = String(e?.cm_highestInjury ?? e?.highestInjury ?? "").toLowerCase();
  const eventType = String(e?.cm_eventType ?? e?.eventType ?? "").toUpperCase(); // ACC / INC / etc.

  if (fatalCount > 0 || highest === "fatal") return "fatal";
  if (eventType === "ACC" || eventType === "ACCIDENT") return "accident";
  return "incident";
}

function pickNarrative(e: RawEvent): string | undefined {
  const raw =
    e?.prelimNarrative ??
    e?.factualNarrative ??
    e?.analysisNarrative ??
    e?.narrative ??
    undefined;

  if (!raw) return undefined;

  return String(raw)
    .replace(/&#x0D;|\r/g, "")
    .trim();
}

function docketUrlFor(ntsbNum?: string): string | undefined {
  if (!ntsbNum) return undefined;
  // This is a reliable “search landing page” even when a direct docket URL isn’t available.
  return `https://www.ntsb.gov/Pages/investigations.aspx?query=${encodeURIComponent(ntsbNum)}`;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const now = new Date();
    const defaultEnd = now;
    const defaultStart = new Date(now);
    defaultStart.setUTCFullYear(now.getUTCFullYear() - 1);

    const start = parseDateSafe(searchParams.get("start")) ?? defaultStart;
    const end = parseDateSafe(searchParams.get("end")) ?? defaultEnd;

    // IMPORTANT: file path must be /data/accidents.json at repo root
    const filePath = path.join(process.cwd(), "data", "accidents.json");
    const rawText = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(rawText);

    // Support multiple JSON shapes
    const rows: RawEvent[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.results)
      ? parsed.results
      : Array.isArray(parsed?.data)
      ? parsed.data
      : Array.isArray(parsed?.points)
      ? parsed.points
      : [];

    let rowsWithCoords = 0;
    let rowsWithDate = 0;
    let rowsInRange = 0;

    const points = rows
      .map((e) => {
        const ll = pickLatLng(e);
        if (ll) rowsWithCoords++;

        const d = pickEventDate(e);
        if (d) rowsWithDate++;

        const ntsbNum = String(e?.cm_ntsbNum ?? e?.ntsbNum ?? "").trim() || undefined;
        const mkey = String(e?.cm_mkey ?? e?.mkey ?? "").trim() || undefined;

        return { e, ll, d, ntsbNum, mkey };
      })
      .filter(({ ll, d }) => {
        if (!ll) return false;
        if (!d) return false;
        if (d < start || d > end) return false;
        rowsInRange++;
        return true;
      })
      .map(({ e, ll, d, ntsbNum, mkey }) => {
        const city = e?.cm_city ?? e?.city ?? undefined;
        const state = e?.cm_state ?? e?.state ?? undefined;
        const country = e?.cm_country ?? e?.country ?? undefined;

        return {
          id: mkey || ntsbNum || `${ll!.lat},${ll!.lng},${d!.toISOString()}`,
          lat: ll!.lat,
          lng: ll!.lng,
          kind: toKind(e),

          date: isoDateOnlyUTC(d!),
          city,
          state,
          country,

          ntsbCaseId: ntsbNum,
          docketUrl: docketUrlFor(ntsbNum),

          summary: pickNarrative(e),
        };
      });

    return NextResponse.json({
      ok: true,
      source: "local:data/accidents.json",
      start: start.toISOString(),
      end: end.toISOString(),
      totalRows: rows.length,
      rowsWithCoords,
      rowsWithDate,
      rowsInRange,
      returnedPoints: points.length,
      points,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
