/**
 * Fix Database Schema for Modern Records
 * 
 * This updates the database schema to handle 2020-2025 accident data
 * with higher precision coordinates and longer field values.
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function fixSchema() {
  console.log('🔧 Fixing database schema for modern records...\n');

  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  
  if (!databaseUrl) {
    console.error('❌ ERROR: DATABASE_URL not found');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔌 Connecting to database...');
    await pool.query('SELECT 1');
    console.log('✓ Connected\n');

    console.log('📝 Reading schema fix...');
    const sqlPath = path.join(__dirname, '..', 'fix_schema.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    console.log('✓ Schema fix loaded\n');

    console.log('⚙️  Applying schema changes...');
    await pool.query(sql);
    console.log('✓ Schema updated successfully!\n');

    console.log('🎉 Done! You can now re-import the 2020-2025 files.\n');
    console.log('Run this command to import those files:');
    console.log('DATABASE_URL="..." node scripts/import-from-blob.js');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

fixSchema();
