import dynamic from "next/dynamic";

const MapView = dynamic(() => import("./components/MapView"), {
  ssr: false,
  loading: () => (
    <div style={{ padding: 16, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial" }}>
      Loading map…
    </div>
  ),
});

export default function Page() {
  return <MapView />;
}
