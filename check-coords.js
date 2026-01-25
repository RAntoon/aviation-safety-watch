const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkCoords() {
  const result = await pool.query(`
    SELECT 
      COUNT(*) as total_records,
      COUNT(*) FILTER (WHERE latitude IS NOT NULL AND longitude IS NOT NULL) as with_coords,
      COUNT(*) FILTER (WHERE latitude IS NULL) as without_coords
    FROM accidents
  `);
  
  const row = result.rows[0];
  console.log('\n📊 Database Coordinate Statistics:');
  console.log(`Total accidents: ${parseInt(row.total_records).toLocaleString()}`);
  console.log(`With coordinates: ${parseInt(row.with_coords).toLocaleString()}`);
  console.log(`Without coordinates: ${parseInt(row.without_coords).toLocaleString()}`);
  console.log(`Percentage mapped: ${((row.with_coords / row.total_records) * 100).toFixed(1)}%\n`);
  
  await pool.end();
}

checkCoords().catch(console.error);
