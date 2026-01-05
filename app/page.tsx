import dynamic from "next/dynamic";

const MapView = dynamic(() => import("./components/MapView"), { ssr: false });

type ApiResponse = {
  ok: boolean;
  start: string;
  end: string;
  dots?: any[];
  message?: string;
  upstreamError?: any;
};

export default function HomePage() {
  return (
    <main>
      <ClientShell />
    </main>
  );
}

// Keep UI client-side to avoid SSR/window issues
const ClientShell = dynamic(() => Promise.resolve(ClientUI), { ssr: false });

function ClientUI() {
  const today = new Date();
  const endDefault = isoDate(today);
  const startDefault = isoDate(new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()));

  const [start, setStart] = useState(startDefault);
  const [end, setEnd] = useState(endDefault);

  const [status, setStatus] = useState<string>("Ready");
  const [dots, setDots] = useState<any[]>([]);

  async function load() {
    setStatus("Loading…");
    try {
      const res = await fetch(`/api/ntsb?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
      const json = (await res.json()) as ApiResponse;

      if (!res.ok || !json.ok) {
        setDots([]);
        setStatus(`NTSB fetch not OK. Open /api/ntsb to see upstreamError.`);
        return;
      }

      setDots(json.dots ?? []);
      setStatus(`OK. Dots: ${json.dots?.length ?? 0}`);
    } catch (e: any) {
      setDots([]);
      setStatus(`Failed: ${String(e)}`);
    }
  }

  // load once on mount
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // legend counts
  const counts = useMemo(() => {
    let fatalAcc = 0, acc = 0, inc = 0;
    for (const d of dots) {
      const isAccident = !!d.isAccident;
      const fatal = Number(d.fatalCount ?? 0) > 0;
      if (isAccident && fatal) fatalAcc++;
      else if (isAccident && !fatal) acc++;
      else inc++;
    }
    return { fatalAcc, acc, inc };
  }, [dots]);

  return (
    <div style={{ position: "relative" }}>
      <div
        style={{
          position: "absolute",
          zIndex: 1000,
          top: 12,
          left: 12,
          width: 360,
          background: "white",
          borderRadius: 10,
          padding: 12,
          boxShadow: "0 6px 20px rgba(0,0,0,0.15)",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 800 }}>Aviation Safety Watch (MVP)</div>
        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
          Data source: NTSB endpoint • Default range: last 12 months
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700 }}>Start</div>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              style={{ width: "100%", padding: 6 }}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700 }}>End</div>
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              style={{ width: "100%", padding: 6 }}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}>
          <button onClick={load} style={{ padding: "6px 10px", borderRadius: 8 }}>
            Reload
          </button>
          <div style={{ fontSize: 12 }}>Dots shown: {dots.length}</div>
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 13 }}>Legend</div>

          <LegendRow color="#d32f2f" label={`Fatal accidents (red): ${counts.fatalAcc}`} />
          <LegendRow color="#f57c00" label={`Accidents (orange): ${counts.acc}`} />
          <LegendRow color="#fbc02d" label={`Incidents (yellow): ${counts.inc}`} />

          <div style={{ marginTop: 10, fontSize: 12 }}>
            <span style={{ fontWeight: 800 }}>Status:</span>{" "}
            <span style={{ color: status.startsWith("OK") ? "green" : "crimson" }}>
              {status}
            </span>
          </div>
        </div>
      </div>

      <MapView dots={dots} />
    </div>
  );
}

function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
      <div
        style={{
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: color,
          border: "1px solid rgba(0,0,0,0.25)",
        }}
      />
      <div style={{ fontSize: 12 }}>{label}</div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";

function isoDate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
