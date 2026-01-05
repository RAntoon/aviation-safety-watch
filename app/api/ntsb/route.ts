import { NextResponse } from "next/server";

const NTSB_BASE =
  "https://api.ntsb.gov/public/api/Aviation/v1/GetCasesByDateRange";

function toYMD(d: Date) {
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

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function pickFirst<T = any>(obj: any, keys: string[]): T | undefined {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k] as T;
  }
  return undefined;
}

function toNum(v: any): number | null {
  if (v === undefined || v === null) return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function classify(caseRow: any) {
  const eventTypeRaw =
    String(
      pickFirst(caseRow, [
        "eventType",
        "EventType",
        "investigationType",
        "InvestigationType",
        "classification",
        "Classification",
      ]) ?? ""
    ).toLowerCase();

  const fatal =
    toNum(
      pickFirst(caseRow, [
        "fatalities",
        "Fatalities",
        "totalFatalInjuries",
        "TotalFatalInjuries",
        "injuryFatal",
        "InjuryFatal",
        "fatal",
        "Fatal",
      ])
    ) ?? 0;

  const isIncident =
    eventTypeRaw.includes("incident") ||
    eventTypeRaw === "inc" ||
    eventTypeRaw.includes("inc.");

  if (fatal > 0) return { bucket: "fatal" as const, fatal };
  if (isIncident) return { bucket: "incident" as const, fatal };
  return { bucket: "accident" as const, fatal };
}

/**
 * Normalize whatever NTSB returns into a stable array your map can use.
 */
function normalizeCases(payload: any) {
  const rows =
    pickFirst<any[]>(payload, ["cases", "Cases", "results", "Results", "data"]) ??
    (Array.isArray(payload) ? payload : []);

  if (!Array.isArray(rows)) return [];

  return rows
    .map((r) => {
      const lat = toNum(
        pickFirst(r, ["latitude", "Latitude", "lat", "Lat", "LAT"])
      );
      const lon = toNum(
        pickFirst(r, ["longitude", "Longitude", "lon", "Lon", "LON", "lng", "Lng"])
      );

      const ntsbNumber =
        pickFirst<string>(r, ["ntsbNumber", "NtsbNumber", "NTSBNumber", "caseNumber", "CaseNumber"]) ??
        "";

      const mkey =
        pickFirst<string>(r, ["mkey", "MKey", "MKEY", "caseId", "CaseId"]) ?? "";

      const eventDate =
        pickFirst<string>(r, ["eventDate", "EventDate", "date", "Date", "occurrenceDate", "OccurrenceDate"]) ??
        "";

      const city =
        pickFirst<string>(r, ["city", "City", "locality", "Locality"]) ?? "";
      const state =
        pickFirst<string>(r, ["state", "State", "province", "Province"]) ?? "";

      const aircraft =
        pickFirst<string>(r, ["makeModel", "MakeModel", "aircraft", "Aircraft"]) ?? "";

      const classification = classify(r);

      // Link to NTSB CAROL “sr-details” using NTSB number when available.
      const detailsUrl =
        ntsbNumber && typeof ntsbNumber === "string"
          ? `https://data.ntsb.gov/carol-main-public/sr-details/${encodeURIComponent(ntsbNumber)}`
          : null;

      return {
        id: mkey || ntsbNumber || `${eventDate}-${lat}-${lon}`,
        lat,
        lon,
        ntsbNumber,
        mkey,
        eventDate,
        city,
        state,
        aircraft,
        bucket: classification.bucket, // "fatal" | "accident" | "incident"
        fatal: classification.fatal,
        detailsUrl,
        raw: r, // keep raw so you can debug/expand later
      };
    })
    .filter((x) => typeof x.lat === "number" && typeof x.lon === "number");
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  tries = 3
): Promise<{ ok: boolean; status: number; text: string }> {
  let lastErrText = "";
  let lastStatus = 0;

  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, init);
      lastStatus = res.status;
      const text = await res.text();
      lastErrText = text;

      // Success
      if (res.ok) return { ok: true, status: res.status, text };

      // Retry on typical transient statuses
      if ([429, 500, 502, 503, 504].includes(res.status) && i < tries - 1) {
        await sleep(400 * (i + 1));
        continue;
      }

      return { ok: false, status: res.status, text };
    } catch (e: any) {
      lastStatus = 0;
      lastErrText = String(e);
      if (i < tries - 1) {
        await sleep(400 * (i + 1));
        continue;
      }
      return { ok: false, status: lastStatus, text: lastErrText };
    }
  }

  return { ok: false, status: lastStatus, text: lastErrText };
}

async function fetchNtsb(startYmd: string, endYmd: string) {
  // Different endpoints sometimes expect different param names/casing.
  const candidates: Array<{
    kind: "GET" | "POST";
    url: string;
    body?: any;
  }> = [
    {
      kind: "GET",
      url: `${NTSB_BASE}?startDate=${encodeURIComponent(startYmd)}&endDate=${encodeURIComponent(endYmd)}`,
    },
    {
      kind: "GET",
      url: `${NTSB_BASE}?StartDate=${encodeURIComponent(startYmd)}&EndDate=${encodeURIComponent(endYmd)}`,
    },
    {
      kind: "GET",
      url: `${NTSB_BASE}?from=${encodeURIComponent(startYmd)}&to=${encodeURIComponent(endYmd)}`,
    },
    {
      kind: "POST",
      url: NTSB_BASE,
      body: { startDate: startYmd, endDate: endYmd },
    },
    {
      kind: "POST",
      url: NTSB_BASE,
      body: { StartDate: startYmd, EndDate: endYmd },
    },
    {
      kind: "POST",
      url: NTSB_BASE,
      body: { from: startYmd, to: endYmd },
    },
  ];

  let lastErr: any = null;

  for (const c of candidates) {
    const init: RequestInit =
      c.kind === "GET"
        ? {
            method: "GET",
            headers: {
              Accept: "application/json",
              "User-Agent": "AviationSafetyWatch/1.0",
            },
            cache: "no-store",
          }
        : {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              "User-Agent": "AviationSafetyWatch/1.0",
            },
            body: JSON.stringify(c.body ?? {}),
            cache: "no-store",
          };

    const res = await fetchWithRetry(c.url, init, 3);

    if (!res.ok) {
      lastErr = {
        tried: { ...c, body: c.body ? c.body : undefined },
        status: res.status,
        bodyPreview: res.text.slice(0, 600),
      };
      continue;
    }

    // parse JSON
    try {
      const payload = JSON.parse(res.text);
      const normalized = normalizeCases(payload);
      return { ok: true as const, urlUsed: c.url, normalized, payload };
    } catch (e: any) {
      lastErr = {
        tried: { ...c, body: c.body ? c.body : undefined },
        status: res.status,
        parseError: String(e),
        bodyPreview: res.text.slice(0, 600),
      };
      continue;
    }
  }

  return { ok: false as const, error: lastErr };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  // client passes ?start=YYYY-MM-DD&end=YYYY-MM-DD
  let start = searchParams.get("start") || "";
  let end = searchParams.get("end") || "";

  if (!start || !end) {
    const r = last12MonthsRange();
    start = toYMD(r.start);
    end = toYMD(r.end);
  }

  const ntsb = await fetchNtsb(start, end);

  if (!ntsb.ok) {
    return NextResponse.json(
      {
        ok: false,
        start,
        end,
        message: "NTSB fetch failed",
        error: ntsb.error,
      },
      { status: 502 }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      start,
      end,
      source: "NTSB Public API",
      urlUsed: ntsb.urlUsed,
      count: ntsb.normalized.length,
      data: ntsb.normalized,
      fetchedAt: new Date().toISOString(),
      // If you want to debug the raw payload in prod, temporarily uncomment:
      // raw: ntsb.payload,
    },
    { status: 200 }
  );
}
