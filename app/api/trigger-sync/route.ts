import { NextResponse } from "next/server";

export async function GET() {
  try {
    // Call the sync-ntsb endpoint with proper authentication
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SITE_URL || 'https://aviation-safety-watch.vercel.app'}/api/sync-ntsb`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${process.env.CRON_SECRET}`,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
        cache: 'no-store',
      }
    );

    const data = await response.json();
    
    return NextResponse.json(data, { status: response.status });
  } catch (error: any) {
    return NextResponse.json(
      { 
        error: error.message, 
        timestamp: new Date().toISOString() 
      },
      { status: 500 }
    );
  }
}