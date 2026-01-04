import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type AirportPoint = {
  code: string;
  name: string;
  lat: number;
  lon: number;
  status: "normal" | "delay" | "ground_stop";
  note?: string;
};

export async function GET() {
  const data: AirportPoint[] = [
    { code: "LAX", name: "Los Angeles Intl", lat: 33.9416, lon: -118.4085, status: "normal" },
    { code: "SFO", name: "San Francisco Intl", lat: 37.6213, lon: -122.3790, status: "delay", note: "Sample delay" },
    { code: "JFK", name: "John F. Kennedy Intl", lat: 40.6413, lon: -73.7781, status: "normal" },
    { code: "ORD", name: "Chicago O'Hare Intl", lat: 41.9742, lon: -87.9073, status: "ground_stop", note: "Sample ground stop" }
  ];

  return NextResponse.json({ updatedAt: new Date().toISOString(), airports: data });
}
