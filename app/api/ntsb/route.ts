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
  return { start: toYMD(start), end: toYMD(end) };
}

async function tryFetch(
  url: string,
  init: RequestInit
): Promise<{ ok: boolean; text: string; status: number }> {
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    return { ok: res.ok, text, status: res.status };
  } catch (e) {
    return { ok: false, text: String(e), status: 0 };
  }
}

async function fetchNTSB(
  start: string,
  end: string
): Promise<{ ok: boolean; urlUsed?: string; data?: any; error?: any }> {
  const candidates = [
    `${NTSB_BASE}?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`,
    `${NTSB_BASE}?StartDate=${encodeURIComponent(start)}&EndDate=${encodeURIComponent(end)}`,
    `${NTSB_BASE}?from=${encodeURIComponent(start)}&to=${encodeURIComponent(end)}`,
  ];

  for (const url of candidates) {
    const r = await tryFetch(url, { method: "GET", headers: { Accept: "application/json" } });
    if (r.ok) {
      try {
        return { ok: true, urlUsed: url, data: JSON.parse(r.text) };
      } catch {
        continue;
      }
    }
  }

  return { ok: false, error: { message: "All patterns failed", tried: candidates } };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  let start = searchParams.get("start") ?? "";
  let end = searchParams.get("end") ?? "";

  if (!start || !end) {
    const r = last12MonthsRange();
    start = r.start;
    end = r.end;
  }

  const ntsb = await fetchNTSB(start, end);

  if (!ntsb.ok) {
    return NextResponse.json(
      { ok: false, start, end, message: "NTSB fetch failed", error: ntsb.error },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, start, end, urlUsed: ntsb.urlUsed, data: ntsb.data }, { status: 200 });
}
