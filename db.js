require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS driver_map (
      unit_id VARCHAR(20)  PRIMARY KEY,
      rr_id   VARCHAR(100) NOT NULL DEFAULT '',
      name    VARCHAR(200) NOT NULL
    );
    CREATE TABLE IF NOT EXISTS transponder_map (
      transponder VARCHAR(50) PRIMARY KEY,
      unit_id     VARCHAR(20) NOT NULL
    );
    -- Links a RoseRocket driver profile to its Motive driver, and records whether the
    -- hours tool should consider that driver at all. Only the link and the flag are
    -- stored; both names are read live from their own system so they can never go stale.
    --
    -- A row can exist with no motive_id for two different reasons, which link_set tells
    -- apart: the driver was merely switched off (link_set false, so the automatic name
    -- match still applies), or the link was deliberately cleared by hand (link_set true,
    -- so the name match must not quietly reinstate itself).
    CREATE TABLE IF NOT EXISTS driver_eld_map (
      rr_user_id VARCHAR(64) PRIMARY KEY,
      motive_id  BIGINT,
      link_set   BOOLEAN     NOT NULL DEFAULT FALSE,
      enabled    BOOLEAN     NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE driver_eld_map ADD COLUMN IF NOT EXISTS enabled  BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE driver_eld_map ADD COLUMN IF NOT EXISTS link_set BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE driver_eld_map ALTER COLUMN motive_id DROP NOT NULL;
  `);
}

// A bare "connect ECONNREFUSED 127.0.0.1:5432" says nothing about what is missing or why
// it matters, which is unhelpful from a scheduled job. Turn the common Postgres failures
// into something that names the cause and the fix.
function describeDbError(err) {
  const url = (process.env.DATABASE_URL || '').replace(/:\/\/([^:]+):[^@]*@/, '://$1:***@');
  const where = url || 'DATABASE_URL (not set)';
  switch (err?.code) {
    case 'ECONNREFUSED':
      return `Cannot reach PostgreSQL at ${where}. Is it running?\n`
        + '  Ubuntu:  sudo apt install postgresql && sudo systemctl start postgresql\n'
        + '  Docker:  docker run -d --name rr-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16\n'
        + '  Then:    createdb rr_auto && npm run seed\n'
        + 'Or point DATABASE_URL at the database the app already uses.';
    case '3D000':
      return `That PostgreSQL server is running but has no such database.\n  createdb rr_auto && npm run seed`;
    case '28P01':
      return `PostgreSQL rejected the credentials in DATABASE_URL (${where}).`;
    case 'ENOTFOUND':
      return `The host in DATABASE_URL could not be resolved (${where}).`;
    default:
      return null;
  }
}

module.exports = { pool, initDb, describeDbError };
