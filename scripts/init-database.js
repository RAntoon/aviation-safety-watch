/**
 * Initialize Database Schema
 * 
 * This script creates the database tables for storing NTSB accident data.
 * Run this once to set up your database structure.
 * 
 * Usage: node scripts/init-database.js
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function initDatabase() {
  console.log('🚀 Initializing Aviation Safety Watch Database...\n');

  // Read database URL from environment
  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  
  if (!databaseUrl) {
    console.error('❌ ERROR: DATABASE_URL or POSTGRES_URL not found in environment variables');
    console.error('Make sure you have a .env.local file with your database credentials');
    process.exit(1);
  }

  console.log('✓ Database URL found');

  // Create connection pool
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    // Test connection
    console.log('🔌 Testing database connection...');
    await pool.query('SELECT NOW()');
    console.log('✓ Database connection successful\n');

    // Read schema file
    console.log('📄 Reading schema file...');
    const schemaPath = path.join(__dirname, '..', 'create_schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    console.log('✓ Schema file loaded\n');

    // Execute schema
    console.log('🏗️  Creating database tables...');
    await pool.query(schema);
    console.log('✓ Tables created successfully\n');

    // Verify tables were created
    console.log('🔍 Verifying table creation...');
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    console.log('✓ Tables found:');
    result.rows.forEach(row => {
      console.log(`  - ${row.table_name}`);
    });

    console.log('\n🎉 Database initialization complete!');
    console.log('\nNext steps:');
    console.log('1. Run the import script to load your JSON data');
    console.log('2. Test the API endpoints\n');

  } catch (error) {
    console.error('❌ ERROR:', error.message);
    console.error('\nFull error details:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the initialization
initDatabase();
