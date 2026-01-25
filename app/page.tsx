"use client";

import { useState, useMemo, useEffect } from "react";
import dynamic from "next/dynamic";
import DataView from "./components/DataView";

const MapView = dynamic(() => import("./components/MapView"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui",
      }}
    >
      Loading map...
    </div>
  ),
});

function isoDate(d: Date) {
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

export default function HomePage() {
  const [view, setView] = useState<"map" | "data">("map");
  const [showDisclaimer, setShowDisclaimer] = useState(true);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const dismissed = localStorage.getItem("disclaimerDismissed") === "true";
      setShowDisclaimer(!dismissed);
    }
  }, []);

  const defaultRange = useMemo(() => last12MonthsRange(), []);
  const [startDate] = useState<string>(isoDate(defaultRange.start));
  const [endDate] = useState<string>(isoDate(defaultRange.end));

  const dismissDisclaimer = () => {
    setShowDisclaimer(false);
    if (typeof window !== "undefined") {
      localStorage.setItem("disclaimerDismissed", "true");
    }
  };

  return (
    <>
      {showDisclaimer && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 10000,
            background: "#fff3cd",
            borderBottom: "2px solid #ffc107",
            padding: "12px 20px",
            fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
            boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
          }}
        >
          <div
            style={{
              maxWidth: 1400,
              margin: "0 auto",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 20,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 20 }}>⚠️</span>
              <div style={{ fontSize: 14, lineHeight: 1.5 }}>
                <strong>Beta Notice:</strong> This site displays aviation accidents with verified coordinates 1962-2026 (
                <strong>178,183 total records</strong>). Records without location data are geocoded to the accident report location or estimated crash site.
              </div>
            </div>
            <button
              onClick={dismissDisclaimer}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid #856404",
                background: "white",
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 12,
                whiteSpace: "nowrap",
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div
        className="view-toggle"
        style={{
          position: "fixed",
          top: showDisclaimer ? 60 : 12,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 9999,
          display: "flex",
          gap: 0,
          background: "white",
          borderRadius: 10,
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          overflow: "hidden",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        }}
      >
        <button
          onClick={() => setView("map")}
          style={{
            padding: "12px 24px",
            border: "none",
            background: view === "map" ? "#1976d2" : "white",
            color: view === "map" ? "white" : "#333",
            cursor: "pointer",
            fontWeight: 700,
            fontSize: 14,
            transition: "all 0.2s",
          }}
        >
          Map View
        </button>
        <button
          onClick={() => setView("data")}
          style={{
            padding: "12px 24px",
            border: "none",
            borderLeft: "1px solid #ddd",
            background: view === "data" ? "#1976d2" : "white",
            color: view === "data" ? "white" : "#333",
            cursor: "pointer",
            fontWeight: 700,
            fontSize: 14,
            transition: "all 0.2s",
          }}
        >
          Data View
        </button>
      </div>

      {view === "map" ? <MapView /> : <DataView startDate={startDate} endDate={endDate} />}
      
      <style jsx global>{`
        @media (max-width: 768px) {
          .view-toggle {
            top: auto !important;
            bottom: 40px !important;
          }
          
          .view-toggle button {
            padding: 8px 16px !important;
            font-size: 12px !important;
          }
        }
      `}</style>
    </>
  );
}