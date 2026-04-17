export default function HowToUsePage() {
  return (
    <div style={{ 
      minHeight: "100vh", 
      background: "linear-gradient(to bottom, #e3f2fd, #ffffff)",
      padding: "40px 20px"
    }}>
      <div style={{ 
        maxWidth: 900, 
        margin: "0 auto",
        background: "white",
        borderRadius: 12,
        padding: "40px",
        boxShadow: "0 4px 20px rgba(0,0,0,0.08)"
      }}>
        <h1 style={{ 
          fontSize: 36, 
          fontWeight: 800, 
          marginBottom: 10,
          color: "#1976d2"
        }}>
          How to Use Aviation Safety Watch
        </h1>
        
        <p style={{ fontSize: 16, color: "#666", marginBottom: 40 }}>
          A comprehensive guide to searching and understanding NTSB aviation accident data
        </p>

        {/* Getting Started */}
        <section style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 28, fontWeight: 700, marginBottom: 20, color: "#333" }}>
            Getting Started
          </h2>
          
          <h3 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12, color: "#1976d2" }}>
            Viewing Accidents on the Map
          </h3>
          <p style={{ fontSize: 16, lineHeight: 1.8, color: "#555", marginBottom: 20 }}>
            When you first visit Aviation Safety Watch, you'll see a map displaying aviation accidents from the past 12 months. Each dot on the map represents an accident location, color-coded by severity. Click on any dot to view detailed information about that specific incident, including the date, location, aircraft type, NTSB case number, and links to official investigation reports.
          </p>

          <h3 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12, color: "#1976d2" }}>
            Using the Date Range Filter
          </h3>
          <p style={{ fontSize: 16, lineHeight: 1.8, color: "#555", marginBottom: 20 }}>
            The control panel on the left allows you to customize your date range. You can manually select start and end dates, or use the quick filters for Last Week, Last Month, or Last Year. Click "Reload" after changing dates to update the map with accidents from your selected timeframe.
          </p>

          <h3 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12, color: "#1976d2" }}>
            Searching All Accidents
          </h3>
          <p style={{ fontSize: 16, lineHeight: 1.8, color: "#555", marginBottom: 20 }}>
            Enable "Search all time (server-side search)" to search across all 178,000+ historical accidents in the database. Type any keyword—such as an NTSB case number, city name, state, aircraft type, or tail number—and results will appear instantly as you type. This powerful search lets you find specific incidents or explore patterns across decades of aviation safety data.
          </p>

          <h3 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12, color: "#1976d2" }}>
            Filtering by Accident Type
          </h3>
          <p style={{ fontSize: 16, lineHeight: 1.8, color: "#555", marginBottom: 20 }}>
            The legend in the control panel shows four accident categories, each with a different color. Click on any category to hide or show those accidents on the map. This helps you focus on specific types of events, such as viewing only fatal accidents or filtering out minor occurrences.
          </p>
        </section>

        {/* Understanding the Data */}
        <section style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 28, fontWeight: 700, marginBottom: 20, color: "#333" }}>
            Understanding Accident Categories
          </h2>

          <div style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8, color: "#d32f2f" }}>
              Fatal Accidents (Red)
            </h3>
            <p style={{ fontSize: 16, lineHeight: 1.8, color: "#555" }}>
              Accidents that resulted in one or more fatalities. These represent the most severe outcomes and are highlighted in red on the map.
            </p>
          </div>

          <div style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8, color: "#fb8c00" }}>
              Accidents (Orange)
            </h3>
            <p style={{ fontSize: 16, lineHeight: 1.8, color: "#555" }}>
              Non-fatal accidents involving substantial aircraft damage or serious injuries. These events are investigated thoroughly by the NTSB to determine causes and prevent future occurrences.
            </p>
          </div>

          <div style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8, color: "#fdd835" }}>
              Incidents (Yellow)
            </h3>
            <p style={{ fontSize: 16, lineHeight: 1.8, color: "#555" }}>
              Events involving operational irregularities or minor damage that don't meet the threshold for an accident classification. Incidents still warrant investigation to identify safety concerns.
            </p>
          </div>

          <div style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8, color: "#2196f3" }}>
              Occurrences (Blue)
            </h3>
            <p style={{ fontSize: 16, lineHeight: 1.8, color: "#555" }}>
              Other reportable aviation events tracked by the NTSB. These represent the least severe category in the database.
            </p>
          </div>
        </section>

        {/* FAQ */}
        <section style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 28, fontWeight: 700, marginBottom: 20, color: "#333" }}>
            Frequently Asked Questions
          </h2>

          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: "#1976d2" }}>
              Where does the data come from?
            </h3>
            <p style={{ fontSize: 16, lineHeight: 1.8, color: "#555" }}>
              All accident data is sourced directly from the NTSB CAROL Query System, the official database maintained by the National Transportation Safety Board. We import this data daily to ensure you have access to the most current information available.
            </p>
          </div>

          <div style={{ marginBottom: 24 }}>
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: "#1976d2" }}>
              How far back does the data go?
            </h3>
            <p style={{ fontSize: 16, lineHeight: 1.8, color: "#555" }}>
              Our database contains accident records dating back to 1962, covering over six decades of U.S. civil aviation safety history. The database includes more than 178,000 total records.
            </p>
          </div>

          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: "#1976d2" }}>
              Why are some accident locations marked as "estimated"?
            </h3>
            <p style={{ fontSize: 16, lineHeight: 1.8, color: "#555" }}>
              Some older records in the NTSB database lack precise GPS coordinates. When an exact location is unavailable, we estimate coordinates based on the city and state information provided. Accidents with estimated locations are clearly marked with a warning badge. Additionally, some accidents occur offshore or involve missing aircraft where precise coordinates are not available.
            </p>
          </div>

          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: "#1976d2" }}>
              What types of aircraft are included?
            </h3>
            <p style={{ fontSize: 16, lineHeight: 1.8, color: "#555" }}>
              The database covers all U.S. civil aviation accidents, including small private aircraft, commercial airlines, helicopters, gliders, balloons, and experimental aircraft. Military aircraft accidents are handled separately by the Department of Defense and are not included in the NTSB civil aviation database.
            </p>
          </div>

          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: "#1976d2" }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: "#1976d2" }}>
              Is this an official NTSB website?
            </h3>
            <p style={{ fontSize: 16, lineHeight: 1.8, color: "#555" }}>
              No. Aviation Safety Watch is an independent resource created to make NTSB accident data more accessible and easier to explore. We are not affiliated with or endorsed by the National Transportation Safety Board. For official NTSB information and final investigation reports, please visit <a href="https://www.ntsb.gov" target="_blank" rel="noopener noreferrer" style={{ color: "#1976d2", textDecoration: "none" }}>ntsb.gov</a>.
            </p>
          </div>

          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: "#1976d2" }}>
              How accurate is the data?
            </h3>
            <p style={{ fontSize: 16, lineHeight: 1.8, color: "#555" }}>
              We display the data exactly as it appears in the NTSB database. While we strive for accuracy in our daily imports, the NTSB occasionally updates or corrects records as investigations progress. If you notice any discrepancies, we encourage you to verify information directly with the official NTSB sources linked in each accident popup.
            </p>
          </div>

          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: "#1976d2" }}>
              Who built this and why?
            </h3>
            <p style={{ fontSize: 16, lineHeight: 1.8, color: "#555" }}>
              Aviation Safety Watch was created to provide researchers, aviation professionals, journalists, and the general public with an easier way to explore and understand aviation safety data. The NTSB's official database is comprehensive but can be difficult to navigate—we built this tool to make that data more accessible through an intuitive map interface.
            </p>
          </div>
        </section>

        {/* Back Link */}
        <div style={{ 
          marginTop: 40, 
          paddingTop: 30, 
          borderTop: "1px solid #e0e0e0",
          textAlign: "center" 
        }}>
          <a 
            href="/about" 
            style={{ 
              color: "#1976d2", 
              textDecoration: "none",
              fontSize: 16,
              fontWeight: 600
            }}
          >
            ← Back to About
          </a>
        </div>

        {/* Footer */}
        <footer style={{ 
          marginTop: 60, 
          paddingTop: 30, 
          borderTop: "1px solid #e0e0e0",
          textAlign: "center",
          color: "#666",
          fontSize: 14
        }}>
          <p>
            © {new Date().getFullYear()} <a href="https://antooncorp.com" target="_blank" rel="noopener noreferrer" style={{ color: "#1976d2", textDecoration: "none" }}>Antoon Corporation</a>. All Rights Reserved.
          </p>
        </footer>
      </div>
    </div>
  );
}
