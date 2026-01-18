import { NextResponse } from "next/server";

export async function GET() {
  try {
    const NTSB_RSS = "https://www.ntsb.gov/_layouts/ntsb.aviation/RSS.aspx";
    
    console.log("Fetching RSS feed...");
    
    const response = await fetch(NTSB_RSS, {
      headers: { "User-Agent": "AviationSafetyWatch/1.0" },
      cache: "no-store"
    });

    if (!response.ok) {
      return NextResponse.json({
        error: `RSS fetch failed: ${response.status}`,
        status: response.status
      });
    }

    const xmlText = await response.text();
    
    // Count items
    const itemMatches = xmlText.match(/<item>/gi);
    const itemCount = itemMatches ? itemMatches.length : 0;
    
    // Get first 2000 characters to see structure
    const preview = xmlText.substring(0, 2000);
    
    return NextResponse.json({
      success: true,
      feedLength: xmlText.length,
      itemsFound: itemCount,
      preview: preview,
      fullFeed: xmlText // WARNING: This might be large
    });
  } catch (error: any) {
    return NextResponse.json({
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
}