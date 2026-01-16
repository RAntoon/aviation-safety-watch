import { NextResponse } from "next/server";

export async function GET() {
  try {
    // Call the sync endpoint with the secret
    const response = await fetch(`${process.env.VERCEL_URL || 'http://localhost:3000'}/api/sync-ntsb`, {
      headers: {
        'Authorization': `Bearer ${process.env.CRON_SECRET}`
      }
    });
    
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}