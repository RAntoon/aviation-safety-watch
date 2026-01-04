import dynamic from "next/dynamic";

const MapView = dynamic(() => import("./components/MapView"), {
  ssr: false,
  loading: () => <div style={{ padding: 20 }}>Loading map…</div>
});

export default function Page() {
  return <MapView />;
}
