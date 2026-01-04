import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const start = searchParams.get("start");
  const end = searchParams.get("end");

  if (!start || !end) {
    return NextResponse.json(
      { error: "Missing start or end date" },
      { status: 400 }
    );
  }

  const url =
    "https://api.ntsb.gov/public/api/Aviation/v1/GetCasesByDateRange" +
    `?startDate=${start}&endDate=${end}`;

  try {
    const r = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!r.ok) {
      return NextResponse.json(
        { error: "NTSB API error", status: r.status },
        { status: 500 }
      );
    }

    const data = await r.json();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Fetch failed" },
      { status: 500 }
    );
  }
}
