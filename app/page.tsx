import dynamic from "next/dynamic";

const MapView = dynamic(() => import("./components/MapView"), {
  ssr: false,
  loading: () => (
    <div style={{ padding: 24, fontFamily: "system-ui" }}>
      Loading map…
    </div>
  ),
});

export default function Page() {
  return <MapView />;
}
