import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

type PointKind = "fatal" | "accident" | "incident";

type MapPoint = {
  id: string;
  lat: number;
  lng: number;
  kind: PointKind;

  date?: string;
  city?: string;
  state?: string;
  country?: string;

  docketUrl?: string;
  ntsbCaseId?: string;
  summary?: string;
};

function parseDateOnly(s?: string): Date | null {
  if (!s) return null;
  // Accept "YYYY-MM-DD" (or anything that starts with it)
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return isNaN(d.getTime()) ? null : d;
}

function toKind(rec: any): PointKind {
  // We try a few common shapes. If you later standardize your JSON fields,
  // we can tighten this up.
  const fatal =
    rec?.fatal === true ||
    rec?.isFatal === true ||
    Number(rec?.fatalities ?? rec?.totalFatalities ?? 0) > 0;

  // “incident vs accident” varies by dataset — defaulting to "accident" if unknown.
  const cls = String(rec?.classification ?? rec?.eventType ?? rec?.type ?? "").toLowerCase();
  const incidentLike = cls.includes("incident");

  if (fatal) return "fatal";
  if (incidentLike) return "incident";
  return "accident";
}

function pickLatLng(rec: any): { lat: number; lng: number } | null {
  // Try common field names
  const lat =
    rec?.lat ??
    rec?.latitude ??
    rec?.Latitude ??
    rec?.location?.lat ??
    rec?.Location?.Latitude;

  const lng =
    rec?.lng ??
    rec?.lon ??
    rec?.long ??
    rec?.longitude ??
    rec?.Longitude ??
    rec?.location?.lng ??
    rec?.location?.lon ??
    rec?.Location?.Longitude;

  const nlat = Number(lat);
  const nlng = Number(lng);

  if (!Number.isFinite(nlat) || !Number.isFinite(nlng)) return null;
  if (Math.abs(nlat) > 90 || Math.abs(nlng) > 180) return null;

  return { lat: nlat, lng: nlng };
}

function makeKey(city?: string, state?: string, country?: string) {
  return [city, state, country].filter(Boolean).join(", ").trim().toLowerCase();
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const start = parseDateOnly(url.searchParams.get("start") ?? undefined);
    const end = parseDateOnly(url.searchParams.get("end") ?? undefined);

    // Read your local JSON
    const accidentsPath = path.join(process.cwd(), "data", "accidents.json");
    const raw = await fs.readFile(accidentsPath, "utf-8");
    const data = JSON.parse(raw);

    // Also read optional geocode cache (if present)
    let geoCache: Record<string, { lat: number; lng: number }> = {};
    try {
      const cachePath = path.join(process.cwd(), "data", "geocode-cache.json");
      const cacheRaw = await fs.readFile(cachePath, "utf-8");
      geoCache = JSON.parse(cacheRaw) ?? {};
    } catch {
      // ok if missing/empty
    }

    const rows: any[] = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];

    const points: MapPoint[] = [];
    let skippedNoDate = 0;
    let skippedOutOfRange = 0;
    let skippedNoLocation = 0;

    for (let i = 0; i < rows.length; i++) {
      const rec = rows[i];

      const dateStr =
        rec?.date ??
        rec?.eventDate ??
        rec?.EventDate ??
        rec?.occurrenceDate ??
        rec?.OccurrenceDate;

      const d = parseDateOnly(dateStr);
      if (!d) {
        skippedNoDate++;
        continue;
      }

      if (start && d < start) {
        skippedOutOfRange++;
        continue;
      }
      if (end) {
        // inclusive end date
        const endPlus = new Date(end);
        endPlus.setUTCDate(endPlus.getUTCDate() + 1);
        if (d >= endPlus) {
          skippedOutOfRange++;
          continue;
        }
      }

      const city = rec?.city ?? rec?.City ?? rec?.location?.city ?? rec?.Location?.City;
      const state = rec?.state ?? rec?.State ?? rec?.location?.state ?? rec?.Location?.State;
      const country = rec?.country ?? rec?.Country ?? rec?.location?.country ?? rec?.Location?.Country ?? "USA";

      // 1) direct lat/lng
      let ll = pickLatLng(rec);

      // 2) fallback to your geocode cache (city/state/country)
      if (!ll) {
        const key = makeKey(city, state, country);
        if (key && geoCache[key]) {
          ll = geoCache[key];
        }
      }

      if (!ll) {
        skippedNoLocation++;
        continue;
      }

      const ntsbCaseId = rec?.ntsbCaseId ?? rec?.NtsbCaseId ?? rec?.caseNumber ?? rec?.CaseNumber ?? rec?.eventId;
      const docketUrl = rec?.docketUrl ?? rec?.DocketUrl ?? rec?.url ?? rec?.Url;

      const summary =
        rec?.summary ??
        rec?.Summary ??
        rec?.synopsis ??
        rec?.Synopsis ??
        rec?.narrative ??
        rec?.Narrative;

      points.push({
        id: String(rec?.id ?? rec?.Id ?? ntsbCaseId ?? `${d.toISOString()}-${i}`),
        lat: ll.lat,
        lng: ll.lng,
        kind: toKind(rec),
        date: String(dateStr).slice(0, 10),
        city,
        state,
        country,
        docketUrl,
        ntsbCaseId: ntsbCaseId ? String(ntsbCaseId) : undefined,
        summary: summary ? String(summary).slice(0, 280) : undefined,
      });
    }

    return NextResponse.json({
      ok: true,
      points,
      debug: {
        totalRows: rows.length,
        returnedPoints: points.length,
        skippedNoDate,
        skippedOutOfRange,
        skippedNoLocation,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: String(err?.message ?? err),
      },
      { status: 500 }
    );
  }
}
