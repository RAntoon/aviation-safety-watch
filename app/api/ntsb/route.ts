import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const startDate = searchParams.get("start"); // YYYY-MM-DD
  const endDate = searchParams.get("end");     // YYYY-MM-DD

  if (!startDate || !endDate) {
    return NextResponse.json(
      { error: "Missing start or end date. Use ?start=YYYY-MM-DD&end=YYYY-MM-DD" },
      { status: 400 }
    );
  }

  const ntsbUrl =
    "https://api.ntsb.gov/public/api/Aviation/v1/GetCasesByDateRange" +
    `?fromDate=${startDate}&toDate=${endDate}`;

  try {
    const res = await fetch(ntsbUrl, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `NTSB error ${res.status}`, details: text.slice(0, 500) },
        { status: 502 }
      );
    }

    const cases = await res.json();

    return NextResponse.json({
      source: "NTSB",
      count: Array.isArray(cases) ? cases.length : 0,
      cases,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Unknown server error" },
      { status: 500 }
    );
  }
}
