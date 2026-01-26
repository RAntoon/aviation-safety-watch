const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkFields() {
  const result = await pool.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'accidents'
    ORDER BY ordinal_position
  `);
  
  console.log('\nAvailable fields in accidents table:\n');
  result.rows.forEach(r => {
    console.log(`  ${r.column_name} (${r.data_type})`);
  });
  
  await pool.end();
}

checkFields().catch(console.error);
