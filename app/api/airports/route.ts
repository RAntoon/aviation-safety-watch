// app/api/airports/route.ts
import { NextResponse } from "next/server";

type AirportStatus = "normal" | "delay" | "ground_stop";

type Airport = {
  code: string; // IATA
  name: string;
  lat: number;
  lon: number;
  status: AirportStatus;
  note?: string;
};

export const runtime = "nodejs"; // safe default on Vercel

export async function GET() {
  // MVP dataset: major US airports (lat/lon are approximate and good enough for mapping)
  const airports: Airport[] = [
    { code: "ATL", name: "Hartsfield–Jackson Atlanta Intl", lat: 33.6407, lon: -84.4277, status: "normal" },
    { code: "LAX", name: "Los Angeles Intl", lat: 33.9416, lon: -118.4085, status: "normal" },
    { code: "ORD", name: "Chicago O'Hare Intl", lat: 41.9742, lon: -87.9073, status: "ground_stop", note: "Sample ground stop" },
    { code: "DFW", name: "Dallas/Fort Worth Intl", lat: 32.8998, lon: -97.0403, status: "normal" },
    { code: "DEN", name: "Denver Intl", lat: 39.8561, lon: -104.6737, status: "normal" },
    { code: "JFK", name: "John F. Kennedy Intl", lat: 40.6413, lon: -73.7781, status: "normal" },
    { code: "SFO", name: "San Francisco Intl", lat: 37.6213, lon: -122.3790, status: "delay", note: "Sample delay" },
    { code: "SEA", name: "Seattle–Tacoma Intl", lat: 47.4502, lon: -122.3088, status: "normal" },
    { code: "LAS", name: "Harry Reid Intl", lat: 36.0840, lon: -115.1537, status: "normal" },
    { code: "PHX", name: "Phoenix Sky Harbor Intl", lat: 33.4342, lon: -112.0116, status: "normal" },

    { code: "MCO", name: "Orlando Intl", lat: 28.4312, lon: -81.3081, status: "normal" },
    { code: "MIA", name: "Miami Intl", lat: 25.7959, lon: -80.2870, status: "normal" },
    { code: "BOS", name: "Boston Logan Intl", lat: 42.3656, lon: -71.0096, status: "normal" },
    { code: "EWR", name: "Newark Liberty Intl", lat: 40.6895, lon: -74.1745, status: "normal" },
    { code: "IAD", name: "Washington Dulles Intl", lat: 38.9531, lon: -77.4565, status: "normal" },
    { code: "DCA", name: "Reagan Washington National", lat: 38.8512, lon: -77.0402, status: "normal" },
    { code: "BWI", name: "Baltimore/Washington Intl", lat: 39.1754, lon: -76.6684, status: "normal" },
    { code: "PHL", name: "Philadelphia Intl", lat: 39.8744, lon: -75.2424, status: "normal" },
    { code: "DTW", name: "Detroit Metro", lat: 42.2162, lon: -83.3554, status: "normal" },
    { code: "MSP", name: "Minneapolis–Saint Paul Intl", lat: 44.8848, lon: -93.2223, status: "normal" },

    { code: "IAH", name: "Houston George Bush Intercontinental", lat: 29.9902, lon: -95.3368, status: "normal" },
    { code: "HOU", name: "Houston Hobby", lat: 29.6454, lon: -95.2789, status: "normal" },
    { code: "AUS", name: "Austin–Bergstrom Intl", lat: 30.1975, lon: -97.6664, status: "normal" },
    { code: "SAT", name: "San Antonio Intl", lat: 29.5337, lon: -98.4698, status: "normal" },
    { code: "DAL", name: "Dallas Love Field", lat: 32.8471, lon: -96.8518, status: "normal" },

    { code: "CLT", name: "Charlotte Douglas Intl", lat: 35.2144, lon: -80.9473, status: "normal" },
    { code: "RDU", name: "Raleigh–Durham Intl", lat: 35.8801, lon: -78.7880, status: "normal" },
    { code: "BNA", name: "Nashville Intl", lat: 36.1263, lon: -86.6774, status: "normal" },
    { code: "MEM", name: "Memphis Intl", lat: 35.0424, lon: -89.9767, status: "normal" },
    { code: "STL", name: "St. Louis Lambert Intl", lat: 38.7487, lon: -90.3700, status: "normal" },

    { code: "TPA", name: "Tampa Intl", lat: 27.9755, lon: -82.5332, status: "normal" },
    { code: "FLL", name: "Fort Lauderdale–Hollywood Intl", lat: 26.0726, lon: -80.1527, status: "normal" },
    { code: "PBI", name: "Palm Beach Intl", lat: 26.6832, lon: -80.0956, status: "normal" },
    { code: "JAX", name: "Jacksonville Intl", lat: 30.4941, lon: -81.6879, status: "normal" },

    { code: "SAN", name: "San Diego Intl", lat: 32.7338, lon: -117.1933, status: "normal" },
    { code: "SJC", name: "San Jose Mineta Intl", lat: 37.3639, lon: -121.9289, status: "normal" },
    { code: "OAK", name: "Oakland Intl", lat: 37.7126, lon: -122.2197, status: "normal" },
    { code: "SMF", name: "Sacramento Intl", lat: 38.6954, lon: -121.5908, status: "normal" },
    { code: "PDX", name: "Portland Intl", lat: 45.5898, lon: -122.5951, status: "normal" },

    { code: "SLC", name: "Salt Lake City Intl", lat: 40.7899, lon: -111.9791, status: "normal" },
    { code: "MCI", name: "Kansas City Intl", lat: 39.2976, lon: -94.7139, status: "normal" },
    { code: "CLE", name: "Cleveland Hopkins Intl", lat: 41.4117, lon: -81.8498, status: "normal" },
    { code: "PIT", name: "Pittsburgh Intl", lat: 40.4915, lon: -80.2329, status: "normal" },

    { code: "SNA", name: "John Wayne (Orange County)", lat: 33.6757, lon: -117.8682, status: "normal" },
    { code: "ONT", name: "Ontario Intl", lat: 34.0560, lon: -117.6012, status: "normal" },
    { code: "BUR", name: "Hollywood Burbank", lat: 34.2007, lon: -118.3587, status: "normal" },
    { code: "LGB", name: "Long Beach", lat: 33.8177, lon: -118.1516, status: "normal" },

    { code: "ANC", name: "Ted Stevens Anchorage Intl", lat: 61.1744, lon: -149.9964, status: "normal" },
    { code: "HNL", name: "Daniel K. Inouye Intl", lat: 21.3187, lon: -157.9225, status: "normal" },
  ];

  return NextResponse.json({
    updatedAt: new Date().toISOString(),
    airports,
  });
}
