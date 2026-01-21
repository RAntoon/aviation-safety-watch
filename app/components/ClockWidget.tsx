"use client";
import { useEffect, useMemo, useState } from "react";

function formatZulu(iso: string) {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}Z`;
}

export default function ClockWidget() {
  const [utcIso, setUtcIso] = useState(new Date().toISOString());
  const [localNow, setLocalNow] = useState(new Date());
  const [source, setSource] = useState("loading");
  const [isOpen, setIsOpen] = useState(false);

  // Update local clock every second
  useEffect(() => {
    const t = setInterval(() => setLocalNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Refresh authoritative UTC once per minute
  useEffect(() => {
    let mounted = true;
    async function refresh() {
      try {
        const res = await fetch("/api/time", { cache: "no-store" });
        const json = await res.json();
        if (!mounted) return;
        setUtcIso(json.utcIso);
        setSource(json.source);
      } catch {
        if (!mounted) return;
        setUtcIso(new Date().toISOString());
        setSource("fallback");
      }
    }
    refresh();
    const t = setInterval(refresh, 60000);
    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, []);

  const zulu = useMemo(() => formatZulu(utcIso), [utcIso]);

  return (
    <>
      <div
        className="clock-widget"
        style={{
          position: "absolute",
          top: 12,
          right: isOpen ? 12 : -200,
          zIndex: 1000,
          background: "rgba(255,255,255,0.95)",
          borderRadius: 12,
          padding: "10px 12px",
          boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
          fontFamily: "system-ui, sans-serif",
          minWidth: 200,
          transition: "right 0.3s ease",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
          Time
        </div>
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Zulu (UTC)</div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{zulu}</div>
        </div>
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Local</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>
            {localNow.toLocaleString()}
          </div>
        </div>
        <div style={{ fontSize: 11, opacity: 0.6 }}>
          Source: {source}
        </div>
      </div>

      {/* Toggle button - thin vertical bar on mobile */}
      <button
        className="clock-toggle"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: "absolute",
          top: "50%",
          right: isOpen ? 224 : 0,
          transform: "translateY(-50%)",
          zIndex: 1001,
          background: "white",
          border: "2px solid #ddd",
          borderRight: "none",
          borderRadius: "8px 0 0 8px",
          padding: "20px 6px",
          cursor: "pointer",
          boxShadow: "-2px 0 8px rgba(0,0,0,0.15)",
          fontSize: 14,
          transition: "right 0.3s ease",
          display: "none",
          writingMode: "vertical-rl",
          textOrientation: "mixed",
        }}
      >
        {isOpen ? "▶" : "◀"}
      </button>

      <style jsx global>{`
        @media (max-width: 768px) {
  .clock-widget {
    display: none !important;
  }

  .clock-toggle {
    display: none !important;
  }
}

        @media (min-width: 769px) {
          .clock-widget {
            right: 12px !important;
          }
        }
      `}</style>
    </>
  );
}