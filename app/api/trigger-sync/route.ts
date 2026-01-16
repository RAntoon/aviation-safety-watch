import { NextResponse } from "next/server";

export async function GET() {
  try {
    // Call the sync endpoint with the secret
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';
      
    const response = await fetch(`${baseUrl}/api/sync-ntsb`, {
      headers: {
        'Authorization': `Bearer ${process.env.CRON_SECRET}`
      }
    });
    
    const contentType = response.headers.get('content-type');
    
    if (contentType?.includes('application/json')) {
      const data = await response.json();
      return NextResponse.json(data);
    } else {
      const text = await response.text();
      return NextResponse.json({ 
        error: 'Non-JSON response',
        status: response.status,
        contentType,
        body: text.substring(0, 500)
      });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}