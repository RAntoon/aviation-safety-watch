import dynamic from "next/dynamic";

const MapView = dynamic(() => import("./components/MapView"), {
  ssr: false, // Leaflet must run client-side
});

export default function Page() {
  return <MapView />;
}
