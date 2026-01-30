import "leaflet/dist/leaflet.css";
import Script from "next/script";

export const metadata = {
  title: "Aviation Safety Watch | Global Aircraft Accidents & Incidents Map",
  description:
    "Interactive map and database of aviation accidents, incidents, and occurrences worldwide since 1962. Search, filter, and explore official NTSB investigation records with direct access to reports and dockets.",
  openGraph: {
    title: "Aviation Safety Watch",
    description:
      "Explore 178,000+ aviation accidents and incidents worldwide using an interactive map and searchable database.",
    url: "https://aviationsafetywatch.com",
    siteName: "Aviation Safety Watch",
    type: "website",
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Aviation Safety Watch - Interactive Aviation Accident Map',
      },
    ],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Google Analytics 4 */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-CH8DN2MYWB"
          strategy="afterInteractive"
        />
        <Script id="ga4-init" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-CH8DN2MYWB', {
              anonymize_ip: true,
            });
          `}
        </Script>
      </head>

      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}