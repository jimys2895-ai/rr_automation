require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { pool, initDb } = require('../db');

async function seed() {
  await initDb();
  const sql = fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8');
  await pool.query(sql);
  console.log('[Seed] Done');
  await pool.end();
}

seed().catch(err => { console.error('[Seed] Error:', err.message); process.exit(1); });
