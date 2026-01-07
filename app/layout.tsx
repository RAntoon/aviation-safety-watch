import "leaflet/dist/leaflet.css";

// app/layout.tsx
export const metadata = {
  title: "Aviation Safety Watch",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
