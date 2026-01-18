import { NextResponse } from "next/server";

export async function GET() {
  try {
    // Calculate date 30 days ago
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const startDate = thirtyDaysAgo.toISOString().split('T')[0];
    
    console.log(`Querying NTSB API from ${startDate}`);

    const apiUrl = `https://data.ntsb.gov/carol-main-public/api/Query/Main`;
    
    const requestBody = {
      "ResultSetSize": 500,
      "ResultSetOffset": 0,
      "QueryGroups": [
        {
          "QueryRules": [
            {
              "FieldName": "EventDate",
              "RuleType": 0,
              "Values": [startDate],
              "Columns": ["Event.EventDate"],
              "Operator": "is greater than"
            }
          ],
          "AndOr": "And"
        }
      ],
      "AndOr": "And",
      "SortColumn": null,
      "SortDescending": true,
      "TargetCollection": "cases",
      "SessionId": Math.floor(Math.random() * 100000)
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'AviationSafetyWatch/1.0'
      },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();

    return NextResponse.json({
      success: response.ok,
      status: response.status,
      dateRangeStart: startDate,
      requestBody: requestBody,
      totalRecords: data.TotalRecords || 0,
      dataCount: data.Data?.length || 0,
      firstFewRecords: data.Data?.slice(0, 3) || [],
      fullResponse: data
    });
  } catch (error: any) {
    return NextResponse.json({
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
}