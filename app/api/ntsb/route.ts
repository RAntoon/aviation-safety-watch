import { NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";

// We must use Node.js runtime because we read files from disk.
export const runtime = "nodejs";

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

  // optional raw fields if you want later (we keep the API light for now)
};

function toISODate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseDateLoose(v: any): Date | null {
  if (!v) return null;

  // If it's already a Date-like
  const d1 = new Date(v);
  if (!Number.isNaN(d1.getTime())) return d1;

  // Try common formats manually (YYYY-MM-DD, MM/DD/YYYY)
  if (typeof v === "string") {
    const s = v.trim();

    // YYYY-MM-DD
    const mIso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (mIso) {
      const d = new Date(`${mIso[1]}-${mIso[2]}-${mIso[3]}T00:00:00Z`);
      if (!Number.isNaN(d.getTime())) return d;
    }

    // MM/DD/YYYY
    const mUS = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (mUS) {
      const mm = String(mUS[1]).padStart(2, "0");
      const dd = String(mUS[2]).padStart(2, "0");
      const yyyy = mUS[3];
      const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }

  return null;
}

function num(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickFirst(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return undefined;
}

function detectLatLng(r: any): { lat: number; lng: number } | null {
  // common keys we might see
  const latVal = pickFirst(r, ["lat", "latitude", "Latitude", "LAT", "y"]);
  const lngVal = pickFirst(r, ["lng", "lon", "long", "longitude", "Longitude", "LON", "x"]);

  const lat = num(latVal);
  const lng = num(lngVal);

  if (lat === null || lng === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

  return { lat, lng };
}

function detectKind(r: any): PointKind {
  // If your JSON has anything like fatalities / fatalInjuries, use it.
  const fat =
    num(pickFirst(r, ["fatalities", "fatal", "totalFatalInjuries", "Total Fatal Injuries"])) ??
    0;

  if (fat > 0) return "fatal";

  // If you have an explicit type/classification, we can map it.
  const classification = String(
    pickFirst(r, ["classification", "eventType", "type", "Occurrence Class"])
  ).toLowerCase();

  if (classification.includes("incident")) return "incident";

  // Default for your current test set (US accidents)
  return "accident";
}

function detectId(r: any, i: number): string {
  const id =
    pickFirst(r, ["id", "eventId", "EventId", "ntsbId", "NtsbId", "caseId", "NTSB Case"]) ??
    null;
  if (id) return String(id);

  // fallback stable-ish id
  const d = pickFirst(r, ["date", "EventDate", "eventDate", "Event Date"]);
  const loc = pickFirst(r, ["city", "City", "state", "State", "location", "Location"]);
  return `row-${i}-${String(d ?? "")}-${String(loc ?? "")}`;
}

function detectDocketUrl(r: any): string | undefined {
  const u = pickFirst(r, ["docketUrl", "docket_url", "Docket URL", "carolUrl", "CAROL URL"]);
  if (!u) return undefined;
  const s = String(u).trim();
  if (!s) return undefined;
  return s;
}

function detectCaseId(r: any): string | undefined {
  const v = pickFirst(r, ["ntsbCaseId", "caseId", "NTSB Case", "EventId", "eventId"]);
  if (!v) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

function detectLocation(r: any) {
  const city = pickFirst(r, ["city", "City"]);
  const state = pickFirst(r, ["state", "State"]);
  const country = pickFirst(r, ["country", "Country"]);
  return {
    city: city ? String(city) : undefined,
    state: state ? String(state) : undefined,
    country: country ? String(country) : undefined,
  };
}

function detectSummary(r: any): string | undefined {
  const s = pickFirst(r, ["summary", "Summary", "synopsis", "Synopsis"]);
  if (!s) return undefined;
  const text = String(s).trim();
  return text ? text.slice(0, 300) : undefined;
}

function detectDate(r: any): { dateISO?: string; dateObj?: Date } {
  const raw = pickFirst(r, ["date", "EventDate", "eventDate", "Event Date", "event_date"]);
  const d = parseDateLoose(raw);
  if (!d) return {};
  return { dateObj: d, dateISO: toISODate(d) };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    // Default: last 12 months
    const now = new Date();
    const defaultEnd = toISODate(now);
    const startDefaultDate = new Date(now);
    startDefaultDate.setFullYear(now.getFullYear() - 1);
    const defaultStart = toISODate(startDefaultDate);

    const startStr = searchParams.get("start") || defaultStart;
    const endStr = searchParams.get("end") || defaultEnd;

    const startDate = parseDateLoose(startStr);
    const endDate = parseDateLoose(endStr);

    if (!startDate || !endDate) {
      return NextResponse.json(
        { ok: false, error: "Invalid start/end. Use YYYY-MM-DD." },
        { status: 400 }
      );
    }

    // Inclusive end date
    const endPlus = new Date(endDate);
    endPlus.setDate(endPlus.getDate() + 1);

    const filePath = path.join(process.cwd(), "data", "accidents.json");
    const raw = await fs.readFile(filePath, "utf8");

    let rows: any[] = [];
    const parsed = JSON.parse(raw);

    // Support either: [ ... ] or { points: [ ... ] } or { data: [ ... ] }
    if (Array.isArray(parsed)) rows = parsed;
    else if (Array.isArray(parsed?.points)) rows = parsed.points;
    else if (Array.isArray(parsed?.data)) rows = parsed.data;
    else rows = [];

    const points: MapPoint[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];

      const ll = detectLatLng(r);
      if (!ll) continue;

      const { dateObj, dateISO } = detectDate(r);
      if (!dateObj) continue;

      // filter to requested window
      if (dateObj < startDate) continue;
      if (dateObj >= endPlus) continue;

      const kind = detectKind(r);
      const { city, state, country } = detectLocation(r);

      points.push({
        id: detectId(r, i),
        lat: ll.lat,
        lng: ll.lng,
        kind,
        date: dateISO,
        city,
        state,
        country,
        docketUrl: detectDocketUrl(r),
        ntsbCaseId: detectCaseId(r),
        summary: detectSummary(r),
      });
    }

    return NextResponse.json({
      ok: true,
      start: startStr,
      end: endStr,
      count: points.length,
      points,
    });
  } catch (err: any) {
    console.error("api/ntsb error:", err);
    return NextResponse.json(
      { ok: false, error: "Server error reading data/accidents.json" },
      { status: 500 }
    );
  }
}
