const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

async function addEventIds() {
  console.log('Starting event_id population...');
  
  const dataDir = path.join(__dirname, '..', 'data');
  const files = fs.readdirSync(dataDir).filter(f => f.startsWith('accidents_') && f.endsWith('.json'));
  
  let totalUpdated = 0;
  
  for (const file of files) {
    console.log(`Processing ${file}...`);
    const filePath = path.join(dataDir, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    
    let fileUpdated = 0;
    
    for (const record of data) {
      // Use cm_mkey as the event_id and cm_ntsbNum as the ntsb_number
      const eventId = record.cm_mkey;
      const ntsbNumber = record.cm_ntsbNum;
      
      if (eventId && ntsbNumber) {
        try {
          const result = await pool.query(
            'UPDATE accidents SET event_id = $1 WHERE ntsb_number = $2',
            [String(eventId), String(ntsbNumber)]
          );
          if (result.rowCount > 0) {
            fileUpdated++;
          }
        } catch (err) {
          console.error(`Error updating ${ntsbNumber}:`, err.message);
        }
      }
    }
    
    console.log(`  ✅ Updated ${fileUpdated} records from ${file}`);
    totalUpdated += fileUpdated;
  }
  
  console.log(`\n🎉 Done! Total records updated: ${totalUpdated}`);
  await pool.end();
}

addEventIds().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});