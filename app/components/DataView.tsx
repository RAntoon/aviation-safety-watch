"use client";

import React, { useState, useMemo } from "react";

type Accident = {
  id: number;
  ntsb_number: string;
  event_date: string;
  event_type: string;
  highest_injury: string;
  city: string | null;
  state: string | null;
  country: string | null;
  aircraft_make: string | null;
  aircraft_model: string | null;
  fatal_count: number;
  latitude: number | null;
  longitude: number | null;
};

type DataViewProps = {
  startDate: string;
  endDate: string;
};

export default function DataView({ startDate, endDate }: DataViewProps) {
  const [accidents, setAccidents] = useState<Accident[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<keyof Accident>("event_date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterInjury, setFilterInjury] = useState<string>("all");

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const url = `/api/accidents/data?start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}`;
      const res = await fetch(url, { cache: "no-store" });
      
      if (!res.ok) {
        throw new Error(`Failed to fetch data: ${res.status}`);
      }
      
      const json = await res.json();
      setAccidents(json.accidents || []);
    } catch (e: any) {
      setError(e.message);
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const filteredAndSorted = useMemo(() => {
    let filtered = [...accidents];

    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (a) =>
          a.ntsb_number?.toLowerCase().includes(search) ||
          a.city?.toLowerCase().includes(search) ||
          a.state?.toLowerCase().includes(search) ||
          a.aircraft_make?.toLowerCase().includes(search) ||
          a.aircraft_model?.toLowerCase().includes(search)
      );
    }

    if (filterInjury !== "all") {
      filtered = filtered.filter((a) => {
        if (filterInjury === "fatal") return a.fatal_count > 0;
        if (filterInjury === "non-fatal") return a.fatal_count === 0;
        return true;
      });
    }

    filtered.sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];

      if (aVal === null) return 1;
      if (bVal === null) return -1;

      if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [accidents, searchTerm, filterInjury, sortField, sortDirection]);

  const handleSort = (field: keyof Accident) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const exportToCSV = () => {
    const headers = [
      "NTSB Number",
      "Date",
      "Type",
      "Injury",
      "Location",
      "Aircraft",
      "Fatal Count",
      "Has Coordinates",
    ];

    const rows = filteredAndSorted.map((a) => [
      a.ntsb_number,
      a.event_date,
      a.event_type,
      a.highest_injury,
      [a.city, a.state, a.country].filter(Boolean).join(", "),
      [a.aircraft_make, a.aircraft_model].filter(Boolean).join(" "),
      a.fatal_count,
      a.latitude && a.longitude ? "Yes" : "No",
    ]);

    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aviation-accidents-${startDate}-to-${endDate}.csv`;
    a.click();
  };

  const stats = useMemo(() => {
    const total = filteredAndSorted.length;
    const fatal = filteredAndSorted.filter((a) => a.fatal_count > 0).length;
    const withCoords = filteredAndSorted.filter((a) => a.latitude && a.longitude).length;
    
    return { total, fatal, withCoords };
  }, [filteredAndSorted]);

  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        overflow: "auto",
        background: "#f5f5f5",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
      }}
    >
      <div
        style={{
          background: "white",
          padding: "20px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}
      >
        <div style={{ maxWidth: 1400, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>Accident Data View</h2>
              <p style={{ margin: "4px 0 0", fontSize: 14, opacity: 0.7 }}>
                Viewing data from {startDate} to {endDate}
              </p>
            </div>
            <button
              onClick={fetchData}
              disabled={loading}
              style={{
                padding: "10px 20px",
                borderRadius: 8,
                border: "1px solid #ddd",
                background: loading ? "#f4f4f4" : "#1976d2",
                color: loading ? "#666" : "white",
                cursor: loading ? "not-allowed" : "pointer",
                fontWeight: 700,
              }}
            >
              {loading ? "Loading..." : accidents.length > 0 ? "Refresh Data" : "Load Data"}
            </button>
          </div>

          {accidents.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 300px", gap: 12, marginTop: 16 }}>
              <input
                type="text"
                placeholder="Search by NTSB#, location, aircraft..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid #ddd",
                  fontSize: 14,
                }}
              />

              <select
                value={filterInjury}
                onChange={(e) => setFilterInjury(e.target.value)}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid #ddd",
                  fontSize: 14,
                }}
              >
                <option value="all">All Injuries</option>
                <option value="fatal">Fatal Only</option>
                <option value="non-fatal">Non-Fatal Only</option>
              </select>

              <button
                onClick={exportToCSV}
                style={{
                  padding: "10px 20px",
                  borderRadius: 8,
                  border: "1px solid #ddd",
                  background: "white",
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                📥 Export to CSV
              </button>
            </div>
          )}

          {accidents.length > 0 && (
            <div style={{ marginTop: 16, display: "flex", gap: 20, fontSize: 14 }}>
              <div>
                <b>Total:</b> {stats.total.toLocaleString()}
              </div>
              <div>
                <b>Fatal:</b> {stats.fatal.toLocaleString()}
              </div>
              <div>
                <b>With Coordinates:</b> {stats.withCoords.toLocaleString()}
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ maxWidth: 1400, margin: "20px auto", padding: "0 20px" }}>
        {error && (
          <div
            style={{
              background: "#ffebee",
              color: "#c62828",
              padding: 16,
              borderRadius: 8,
              marginBottom: 20,
            }}
          >
            <b>Error:</b> {error}
          </div>
        )}

        {!loading && accidents.length === 0 && !error && (
          <div
            style={{
              background: "white",
              padding: 40,
              borderRadius: 12,
              textAlign: "center",
              boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
            }}
          >
            <p style={{ fontSize: 16, opacity: 0.7 }}>Click "Load Data" to view accident records</p>
          </div>
        )}

        {accidents.length > 0 && (
          <div
            style={{
              background: "white",
              borderRadius: 12,
              boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
              overflow: "hidden",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f5f5f5", borderBottom: "2px solid #ddd" }}>
                  <th
                    onClick={() => handleSort("ntsb_number")}
                    style={{ padding: 12, textAlign: "left", cursor: "pointer", fontWeight: 800 }}
                  >
                    NTSB # {sortField === "ntsb_number" && (sortDirection === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    onClick={() => handleSort("event_date")}
                    style={{ padding: 12, textAlign: "left", cursor: "pointer", fontWeight: 800 }}
                  >
                    Date {sortField === "event_date" && (sortDirection === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    onClick={() => handleSort("highest_injury")}
                    style={{ padding: 12, textAlign: "left", cursor: "pointer", fontWeight: 800 }}
                  >
                    Injury {sortField === "highest_injury" && (sortDirection === "asc" ? "↑" : "↓")}
                  </th>
                  <th style={{ padding: 12, textAlign: "left", fontWeight: 800 }}>Location</th>
                  <th style={{ padding: 12, textAlign: "left", fontWeight: 800 }}>Aircraft</th>
                  <th
                    onClick={() => handleSort("fatal_count")}
                    style={{ padding: 12, textAlign: "left", cursor: "pointer", fontWeight: 800 }}
                  >
                    Fatal {sortField === "fatal_count" && (sortDirection === "asc" ? "↑" : "↓")}
                  </th>
                  <th style={{ padding: 12, textAlign: "center", fontWeight: 800 }}>Coords</th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSorted.map((a, idx) => (
                  <tr
                    key={a.id}
                    style={{
                      borderBottom: "1px solid #eee",
                      background: idx % 2 === 0 ? "white" : "#fafafa",
                    }}
                  >
                    <td style={{ padding: 12 }}>
                      <a
                        href={`https://data.ntsb.gov/Docket/?NTSBNumber=${a.ntsb_number}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "#1976d2", textDecoration: "none", fontWeight: 600 }}
                      >
                        {a.ntsb_number}
                      </a>
                    </td>
                    <td style={{ padding: 12 }}>{a.event_date}</td>
                    <td style={{ padding: 12 }}>
                      <span
                        style={{
                          background: a.fatal_count > 0 ? "#ffebee" : "#e3f2fd",
                          color: a.fatal_count > 0 ? "#c62828" : "#1565c0",
                          padding: "4px 8px",
                          borderRadius: 4,
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        {a.highest_injury}
                      </span>
                    </td>
                    <td style={{ padding: 12, fontSize: 14 }}>
                      {[a.city, a.state, a.country].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td style={{ padding: 12, fontSize: 14 }}>
                      {[a.aircraft_make, a.aircraft_model].filter(Boolean).join(" ") || "—"}
                    </td>
                    <td style={{ padding: 12, textAlign: "center" }}>{a.fatal_count || "—"}</td>
                    <td style={{ padding: 12, textAlign: "center" }}>
                      {a.latitude && a.longitude ? "✓" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}