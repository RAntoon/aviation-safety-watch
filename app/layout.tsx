import "leaflet/dist/leaflet.css";
import Script from "next/script";

export const metadata = {
  title: "Aviation Safety Watch",
  description: "Global aviation accident and incident visualization using NTSB data",
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

      <body style={{ margin: 0, padding: 0 }}>
        {children}
      </body>
    </html>
  );
}
