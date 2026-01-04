export const metadata = {
  title: "Aviation Safety Watch",
  description: "Live U.S. aviation safety and delay dashboard"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
