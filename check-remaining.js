const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkRemaining() {
  const result = await pool.query(`
    SELECT ntsb_number, event_date, city, state, country
    FROM accidents
    WHERE latitude IS NULL
    ORDER BY event_date DESC
  `);
  
  console.log(`\n🔍 Remaining ${result.rows.length} accidents without coordinates:\n`);
  result.rows.forEach(r => {
    const location = [r.city, r.state, r.country].filter(Boolean).join(', ') || '[NO LOCATION DATA]';
    console.log(`${r.ntsb_number} | ${r.event_date?.toISOString().split('T')[0]} | ${location}`);
  });
  
  await pool.end();
}

checkRemaining().catch(console.error);
