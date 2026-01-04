import MapView from "./components/MapView";

async function getNtsbCases() {
  const start = "2025-01-01";
  const end = "2026-01-01";

  const res = await fetch(
    `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/api/ntsb?start=${start}&end=${end}`,
    { cache: "no-store" }
  );

  // If NEXT_PUBLIC_SITE_URL isn't set (common on Vercel), fall back to relative fetch:
  if (!res.ok) {
    const fallback = await fetch(`/api/ntsb?start=${start}&end=${end}`, { cache: "no-store" });
    return fallback.json();
  }

  return res.json();
}

export default async function Page() {
  const data = await getNtsbCases();
  return <MapView cases={data.cases ?? []} />;
}
