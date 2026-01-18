import { NextResponse } from "next/server";

export async function GET() {
  try {
    // Calculate date 30 days ago
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const startDate = thirtyDaysAgo.toISOString().split('T')[0];
    const endDate = new Date().toISOString().split('T')[0];
    
    console.log(`Querying NTSB API from ${startDate} to ${endDate}`);

    const apiUrl = `https://data.ntsb.gov/carol-main-public/api/Query/Main`;
    
    const requestBody = {
      "EventDateFrom": startDate,
      "EventDateTo": endDate,
      "InvestigationType": "Aviation",
      "PageSize": 500,
      "PageNumber": 1,
      "SortColumn": "EventDate",
      "SortDirection": "desc"
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'AviationSafetyWatch/1.0'
      },
      body: JSON.stringify(requestBody)
    });

    const responseText = await response.text();
    
    let parsedData;
    try {
      parsedData = JSON.parse(responseText);
    } catch (e) {
      parsedData = null;
    }

    return NextResponse.json({
      success: response.ok,
      status: response.status,
      dateRange: `${startDate} to ${endDate}`,
      requestBody: requestBody,
      responsePreview: responseText.substring(0, 2000),
      parsedData: parsedData,
      dataCount: parsedData?.Data?.length || 0,
      totalRecords: parsedData?.TotalRecords || 0
    });
  } catch (error: any) {
    return NextResponse.json({
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
}