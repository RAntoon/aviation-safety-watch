/**
 * Check Database Size and Statistics
 */

const { Pool } = require('pg');

async function checkDatabase() {
  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL not found');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('📊 Checking database statistics...\n');

    // Get database size
    const sizeResult = await pool.query(`
      SELECT pg_size_pretty(pg_database_size(current_database())) as size;
    `);
    console.log(`Database size: ${sizeResult.rows[0].size}`);

    // Get table sizes
    const tableResult = await pool.query(`
      SELECT 
        schemaname,
        tablename,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
        pg_total_relation_size(schemaname||'.'||tablename) AS size_bytes
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY size_bytes DESC;
    `);

    console.log('\nTable sizes:');
    tableResult.rows.forEach(row => {
      console.log(`  ${row.tablename}: ${row.size}`);
    });

    // Get record count
    const countResult = await pool.query('SELECT COUNT(*) FROM accidents');
    console.log(`\nTotal accidents: ${parseInt(countResult.rows[0].count).toLocaleString()}`);

    // Check column types
    const columnsResult = await pool.query(`
      SELECT column_name, data_type, character_maximum_length, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_name = 'accidents'
      AND column_name IN ('latitude', 'longitude', 'airport_id', 'registration_number')
      ORDER BY column_name;
    `);

    console.log('\nCurrent column definitions:');
    columnsResult.rows.forEach(row => {
      const type = row.numeric_precision 
        ? `${row.data_type}(${row.numeric_precision},${row.numeric_scale})`
        : row.character_maximum_length
        ? `${row.data_type}(${row.character_maximum_length})`
        : row.data_type;
      console.log(`  ${row.column_name}: ${type}`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkDatabase();