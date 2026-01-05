"use client";

import { useEffect, useMemo, useState } from "react";

function fmtZulu(utcIso: string) {
  const d = new Date(utcIso);
  // Example: 22:14:03Z
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}Z`;
}

function fmtLocal(d: Date) {
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function ClockWidget() {
  const [utcIso, setUtcIso] = useState<string>(new Date().toISOString());
  const [localNow, setLocalNow] = useState<Date>(new Date());
  const [source, setSource] = useState<string>("loading…");

  // Update local display every second (fast, no network)
  useEffect(() => {
    const t = setInterval(() => setLocalNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Refresh “official” UTC periodically (slow, network)
  useEffect(() => {
    let mounted = true;

    async function pull() {
      try {
        const res = await fetch("/api/time", { cache: "no-store" });
        const j = await res.json();
        if (!mounted) return;

        if (j?.utcIso) setUtcIso(String(j.utcIso));
        setSource(j?.source ? String(j.source) : "unknown");
      } catch {
        if (!mounted) return;
        setUtcIso(new Date().toISOString());
        setSource("fallback (client clock)");
      }
    }

    pull();
    const t = setInterval(pull, 60_000); // refresh once/min
    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, []);

  const zulu = useMemo(() => fmtZulu(utcIso), [utcIso]);
  const local = useMemo(() => fmtLocal(localNow), [localNow]);

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        zIndex: 1000,
        background: "rgba(255,255,255,0.92)",
        backdropFilter: "blur(6px)",
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: 12,
        padding: "10px 12px",
        minWidth: 210,
        boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial',
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 6 }}>
        Time
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.75 }}>Zulu (UTC)</div>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 0.5 }}>
            {zulu}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 12, opacity: 0.75 }}>Local</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{local}</div>
        </div>

        <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
          Source: {source}
        </div>
      </div>
    </div>
  );
}
