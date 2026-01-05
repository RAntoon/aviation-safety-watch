import dynamic from "next/dynamic";

const MapView = dynamic(() => import("./components/MapView"), {
  ssr: false,
  loading: () => (
    <main
      style={{
        height: "100vh",
        width: "100vw",
        display: "grid",
        placeItems: "center",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
      }}
    >
      Loading map…
    </main>
  ),
});

export default function HomePage() {
  return (
    <main style={{ height: "100vh", width: "100vw" }}>
      <MapView />
    </main>
  );
}
