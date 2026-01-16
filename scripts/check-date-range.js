const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkData() {
  console.log('Checking data for 1965-01-15 to 1968-01-15...\n');
  
  const r = await pool.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN 1 END) as with_coords
    FROM accidents 
    WHERE event_date >= '1965-01-15' AND event_date <= '1968-01-15'
  `);
  
  console.log('Total accidents in range:', r.rows[0].total);
  console.log('With coordinates:', r.rows[0].with_coords);
  
  // Also check the earliest and latest dates
  const dateRange = await pool.query(`
    SELECT 
      MIN(event_date)::date as earliest,
      MAX(event_date)::date as latest
    FROM accidents
  `);
  
  console.log('\nDate range in database:');
  console.log('Earliest:', dateRange.rows[0].earliest);
  console.log('Latest:', dateRange.rows[0].latest);
  
  await pool.end();
}

checkData().catch(console.error);