import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

type RawEvent = any;

function asISODateOnly(d: Date) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseDateParam(s: string | null, fallback: Date) {
  if (!s) return fallback;
  const d = new Date(s);
  return isNaN(d.getTime()) ? fallback : d;
}

function toKind(e: RawEvent): "fatal" | "accident" | "incident" {
  const fatalCount = Number(e?.cm_fatalInjuryCount ?? 0);
  const highest = String(e?.cm_highestInjury ?? "").toLowerCase();
  const eventType = String(e?.cm_eventType ?? "").toUpperCase(); // ACC / INC / etc.

  if (fatalCount > 0 || highest === "fatal") return "fatal";
  if (eventType === "ACC") return "accident";
  return "incident";
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const now = new Date();
    const defaultEnd = now;
    const defaultStart = new Date(now);
    defaultStart.setUTCFullYear(now.getUTCFullYear() - 1);

    const start = parseDateParam(searchParams.get("start"), defaultStart);
    const end = parseDateParam(searchParams.get("end"), defaultEnd);

    // Read local file: /data/accidents.json
    const filePath = path.join(process.cwd(), "data", "accidents.json");
    const rawText = fs.readFileSync(filePath, "utf8");

    const parsed = JSON.parse(rawText);

    // Support either:
    // 1) top-level array: [ {...}, {...} ]
    // 2) wrapped object: { results:[...] } or { data:[...] } or { points:[...] }
    const rows: RawEvent[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.results)
      ? parsed.results
      : Array.isArray(parsed?.data)
      ? parsed.data
      : Array.isArray(parsed?.points)
      ? parsed.points
      : [];

    const points = rows
      .map((e) => {
        const lat = Number(e?.cm_Latitude);
        const lng = Number(e?.cm_Longitude);
        const eventDate = e?.cm_eventDate ? new Date(e.cm_eventDate) : null;

        return {
          raw: e,
          lat,
          lng,
          eventDate,
        };
      })
      .filter(({ lat, lng, eventDate, raw }) => {
        // must have usable coordinates
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
        // must have event date
        if (!eventDate || isNaN(eventDate.getTime())) return false;
        // must be within date range (inclusive)
        if (eventDate < start || eventDate > end) return false;

        // OPTIONAL: if you want US-only, keep this ON.
        // If you want worldwide, comment this out.
        const country = String(raw?.cm_country ?? "").toUpperCase();
        if (country && country !== "USA" && country !== "US") return false;

        return true;
      })
      .map(({ raw, lat, lng, eventDate }) => {
        const ntsbNum = String(raw?.cm_ntsbNum ?? "");
        const mkey = String(raw?.cm_mkey ?? "");

        // Safe “link out” that always works (search by NTSB number)
        const docketUrl =
          ntsbNum
            ? `https://www.ntsb.gov/Pages/investigations.aspx?query=${encodeURIComponent(ntsbNum)}`
            : undefined;

        return {
          id: mkey || ntsbNum || `${lat},${lng},${eventDate.toISOString()}`,
          lat,
          lng,
          kind: toKind(raw),

          date: asISODateOnly(eventDate),
          city: raw?.cm_city ?? undefined,
          state: raw?.cm_state ?? undefined,
          country: raw?.cm_country ?? undefined,

          ntsbCaseId: ntsbNum || undefined,
          docketUrl,

          summary:
            raw?.prelimNarrative
              ? String(raw.prelimNarrative).replace(/&#x0D;|\r/g, "").trim()
              : undefined,
        };
      });

    return NextResponse.json({
      ok: true,
      source: "local:data/accidents.json",
      start: start.toISOString(),
      end: end.toISOString(),
      totalRows: rows.length,
      returnedPoints: points.length,
      points,
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
