"use client";

import Link from "next/link";

export default function AboutPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f5f5f5",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
      }}
    >
      {/* Header */}
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
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <Link href="/" style={{ textDecoration: "none" }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: "#1976d2", cursor: "pointer" }}>
              Aviation Safety Watch
            </h1>
          </Link>
          <div style={{ marginTop: 12, display: "flex", gap: 20 }}>
            <Link href="/" style={{ color: "#333", textDecoration: "none", fontWeight: 600 }}>
              ← Back to Map
            </Link>
            <span style={{ color: "#1976d2", fontWeight: 600, borderBottom: "2px solid #1976d2", paddingBottom: 2 }}>
              About
            </span>
            <Link href="/about/how-to-use" style={{ color: "#666", textDecoration: "none" }}>
              How to Use & FAQ
            </Link>
            <Link href="/contact" style={{ color: "#666", textDecoration: "none" }}>
              Contact
            </Link>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ maxWidth: 1200, margin: "40px auto", padding: "0 20px" }}>
        <div
          style={{
            background: "white",
            borderRadius: 12,
            boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
            padding: 40,
          }}
        >
          <h1 style={{ fontSize: 36, fontWeight: 800, color: "#333", marginTop: 0 }}>
            About Aviation Safety Watch
          </h1>

          <p style={{ fontSize: 16, lineHeight: 1.6, color: "#444", marginBottom: 24 }}>
            Aviation Safety Watch is a comprehensive database and interactive visualization tool for civil aviation accidents in the United States. Our mission is to make aviation safety data accessible and searchable for researchers, aviation professionals, students, journalists, and the public.
          </p>

          <h2 style={{ fontSize: 24, fontWeight: 700, color: "#1976d2", marginTop: 40, marginBottom: 16 }}>
            What We Provide
          </h2>

          <p style={{ fontSize: 16, lineHeight: 1.6, color: "#444", marginBottom: 16 }}>
            We maintain a complete, searchable database of over 178,000 aviation accident records sourced directly from the National Transportation Safety Board (NTSB). Our interactive map allows users to:
          </p>

          <ul style={{ fontSize: 16, lineHeight: 1.8, color: "#444", marginBottom: 24 }}>
            <li>Search and filter accidents by date, location, aircraft type, and severity</li>
            <li>View detailed accident information including NTSB investigation reports</li>
            <li>Analyze safety trends and patterns over time</li>
            <li>Access direct links to official NTSB dockets and reports</li>
          </ul>

          <h2 style={{ fontSize: 24, fontWeight: 700, color: "#1976d2", marginTop: 40, marginBottom: 16 }}>
            Our Data Source
          </h2>

          <p style={{ fontSize: 16, lineHeight: 1.6, color: "#444", marginBottom: 16 }}>
            All accident data is sourced from the NTSB's CAROL Query System, the official database of civil aviation accidents and incidents in the United States. The database includes accidents from 1962 to present and is updated daily to ensure accuracy and completeness.
          </p>

          <p style={{ fontSize: 16, lineHeight: 1.6, color: "#444", marginBottom: 16 }}>
            Records include detailed information such as:
          </p>

          <ul style={{ fontSize: 16, lineHeight: 1.8, color: "#444", marginBottom: 24 }}>
            <li>Accident date, time, and location</li>
            <li>Aircraft make and model</li>
            <li>Injury severity and fatality counts</li>
            <li>Investigation status and findings</li>
            <li>Links to official NTSB reports</li>
          </ul>

          <h2 style={{ fontSize: 24, fontWeight: 700, color: "#1976d2", marginTop: 40, marginBottom: 16 }}>
            Why Aviation Safety Watch?
          </h2>

          <p style={{ fontSize: 16, lineHeight: 1.6, color: "#444", marginBottom: 24 }}>
            While the NTSB provides comprehensive data, navigating their systems can be challenging. Aviation Safety Watch simplifies access to this critical safety information through an intuitive interface that combines mapping, search, and filtering capabilities.
          </p>

          <p style={{ fontSize: 16, lineHeight: 1.6, color: "#444", marginBottom: 24 }}>
            Our goal is to support aviation safety through transparency and accessibility of accident data.
          </p>

          <h2 style={{ fontSize: 24, fontWeight: 700, color: "#1976d2", marginTop: 40, marginBottom: 16 }}>
            Contact
          </h2>

          <p style={{ fontSize: 16, lineHeight: 1.6, color: "#444", marginBottom: 40 }}>
            For questions, feedback, or data inquiries, please use our <Link href="/contact" style={{ color: "#1976d2", textDecoration: "none", fontWeight: 600 }}>contact form</Link>.
          </p>

          <div
            style={{
              borderTop: "1px solid #ddd",
              paddingTop: 24,
              marginTop: 40,
              fontSize: 14,
              color: "#666",
              fontStyle: "italic",
            }}
          >
            <p style={{ margin: 0 }}>
              Aviation Safety Watch is an independent resource and is not affiliated with the NTSB or any government agency. All data is sourced from publicly available NTSB records.
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          background: "white",
          borderTop: "1px solid #ddd",
          padding: "20px",
          marginTop: 60,
          textAlign: "center",
        }}
      >
        <p style={{ margin: 0, fontSize: 14, color: "#666" }}>
          © 2026 Antoon Corporation – All Rights Reserved.
        </p>
      </div>
    </div>
  );
}