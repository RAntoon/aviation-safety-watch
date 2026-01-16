import { NextResponse } from "next/server";

export async function GET() {
  try {
    const cronSecret = process.env.CRON_SECRET;
    
    // Debug info
    if (!cronSecret) {
      return NextResponse.json({ 
        error: 'CRON_SECRET not found in environment variables',
        availableEnvVars: Object.keys(process.env).filter(k => !k.includes('PASSWORD') && !k.includes('TOKEN'))
      });
    }
    
    // Call the sync endpoint with the secret
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';
      
    const response = await fetch(`${baseUrl}/api/sync-ntsb`, {
      headers: {
        'Authorization': `Bearer ${cronSecret}`
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
        secretLength: cronSecret.length,
        body: text.substring(0, 500)
      });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}