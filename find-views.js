const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

async function findViews() {
  const result = await pool.query(`
    SELECT 
      schemaname,
      viewname,
      definition
    FROM pg_views
    WHERE schemaname = 'public'
  `);
  
  console.log('\nViews in database:\n');
  result.rows.forEach(v => {
    console.log(`View: ${v.viewname}`);
    console.log(`Definition: ${v.definition}\n`);
  });
  
  await pool.end();
}

findViews().catch(console.error);
