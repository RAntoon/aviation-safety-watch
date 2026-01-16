const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkMissingCoords() {
  console.log('Checking records without coordinates by year...\n');
  
  const r = await pool.query(`
    SELECT 
      EXTRACT(YEAR FROM event_date) as year,
      COUNT(*) as total,
      COUNT(CASE WHEN latitude IS NOT NULL THEN 1 END) as with_coords,
      COUNT(CASE WHEN latitude IS NULL THEN 1 END) as missing_coords
    FROM accidents 
    WHERE event_date IS NOT NULL
    GROUP BY EXTRACT(YEAR FROM event_date)
    ORDER BY year
  `);
  
  let totalMissing = 0;
  
  console.log('Year | Total | With Coords | Missing Coords');
  console.log('-----|-------|-------------|---------------');
  r.rows.forEach(row => {
    console.log(`${row.year} | ${row.total} | ${row.with_coords} | ${row.missing_coords}`);
    totalMissing += parseInt(row.missing_coords);
  });
  
  console.log(`\nTotal records missing coordinates: ${totalMissing.toLocaleString()}`);
  
  await pool.end();
}

checkMissingCoords().catch(console.error);