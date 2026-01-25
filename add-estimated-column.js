const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

async function addColumn() {
  try {
    console.log('Adding location_estimated column...');
    
    await pool.query(`
      ALTER TABLE accidents 
      ADD COLUMN IF NOT EXISTS location_estimated BOOLEAN DEFAULT false
    `);
    
    console.log('✅ Column added successfully!');
    
    // Verify it was added
    const result = await pool.query(`
      SELECT column_name, data_type, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'accidents' 
      AND column_name = 'location_estimated'
    `);
    
    if (result.rows.length > 0) {
      console.log('Verified:', result.rows[0]);
    }
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

addColumn();
