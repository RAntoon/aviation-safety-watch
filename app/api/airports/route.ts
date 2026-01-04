import { NextRequest, NextResponse } from "next/server";

type AirportStatus = {
  code: string;
  name?: string;
  status: "normal" | "delay" | "ground_stop" | "unknown";
  note?: string;
  raw?: any;
};

function parseAswsXml(xml: string): Partial<AirportStatus> {
  // Very lightweight XML parsing without extra dependencies.
  // ASWS commonly includes tags like: <Name>, <Delay>, <AvgDelay>, <Reason>, <GroundStop>
  const get = (tag: string) => {
    const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
    return m?.[1]?.trim();
  };

  const name = get("Name");
  const delay = (get("Delay") || "").toLowerCase() === "true";
  const groundStop = (get("GroundStop") || "").toLowerCase() === "true";
  const reason = get("Reason");
  const avgDelay = get("AvgDelay");

  let status: AirportStatus["status"] = "unknown";
  if (groundStop) status = "ground_stop";
  else if (delay) status = "delay";
  else if (!delay && !groundStop) status = "normal";

  const noteParts = [reason, avgDelay ? `AvgDelay: ${avgDelay}` : ""].filter(Boolean);
  const note = noteParts.length ? noteParts.join(" • ") : undefined;

  return { name, status, note };
}

async function fetchAirportStatus(code: string): Promise<AirportStatus> {
  // This is the FAA Airport Status Web Service (ASWS) endpoint that many tools (including NAS Status-style apps) rely on.
  // We call it SERVER-SIDE to avoid browser CORS issues.
  const url = `https://soa.smext.faa.gov/asws/api/airport/status/${encodeURIComponent(code)}`;

  const res = await fetch(url, {
    // keep cache modest; you can tighten later
    cache: "no-store",
    headers: {
      // Some deployments respond with XML by default; we accept either.
      Accept: "application/json, text/xml, application/xml;q=0.9, */*;q=0.8",
    },
  });

  const text = await res.text();

  // Try JSON first
  try {
    const json = JSON.parse(text);

    // JSON shapes vary, so we defensively map.
    const name: string | undefined =
      json?.Name || json?.name || json?.airport?.name || json?.Airport?.Name;

    const delayVal =
      json?.Delay ?? json?.delay ?? json?.airport?.delay ?? json?.Airport?.Delay;
    const groundStopVal =
      json?.GroundStop ?? json?.groundStop ?? json?.Airport?.GroundStop;

    const delay = String(delayVal).toLowerCase() === "true";
    const groundStop = String(groundStopVal).toLowerCase() === "true";

    let status: AirportStatus["status"] = "unknown";
    if (groundStop) status = "ground_stop";
    else if (delay) status = "delay";
    else if (!delay && !groundStop) status = "normal";

    const reason =
      json?.Reason ?? json?.reason ?? json?.Airport?.Reason ?? json?.Status?.Reason;
    const avgDelay =
      json?.AvgDelay ?? json?.avgDelay ?? json?.Airport?.AvgDelay ?? json?.Status?.AvgDelay;

    const noteParts = [reason, avgDelay ? `AvgDelay: ${avgDelay}` : ""].filter(Boolean);
    const note = noteParts.length ? noteParts.join(" • ") : undefined;

    return { code, name, status, note, raw: json };
  } catch {
    // Fall back to XML
    const parsed = parseAswsXml(text);
    return {
      code,
      name: parsed.name,
      status: parsed.status ?? "unknown",
      note: parsed.note,
      raw: undefined,
    };
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const codesParam = searchParams.get("codes") || "LAX,SFO,JFK,ORD";
  const codes = codesParam
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 25);

  try {
    const results = await Promise.all(codes.map((c) => fetchAirportStatus(c)));

    return NextResponse.json(
      {
        updatedAt: new Date().toISOString(),
        source: "FAA ASWS airport status (server-side fetch)",
        airports: results,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        updatedAt: new Date().toISOString(),
        source: "FAA ASWS airport status (server-side fetch)",
        error: e?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
