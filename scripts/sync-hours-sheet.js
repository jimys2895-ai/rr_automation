#!/usr/bin/env node
// One-shot sheet sync, for running under an external scheduler (a Render cron job, systemd
// timer, or crontab) instead of the server's own in-process schedule. Exits non-zero on
// failure so the scheduler can report it.
//
//   npm run sync:hours            rolling window from HOURS_SYNC_DAYS
//   npm run sync:hours -- 7       override the window for this run
//   npm run sync:hours -- --dry   report what it would write, touching nothing
require('dotenv').config();
const { pool, describeDbError } = require('../db');
const { syncHoursSheet } = require('../src/hoursSheet');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry') || args.includes('--dry-run');
const days = Number(args.find(a => /^\d+$/.test(a))) || undefined;

syncHoursSheet({ dryRun, days })
  .then(async summary => {
    console.log(JSON.stringify(summary, null, 1));
    await pool.end();
    process.exit(0);
  })
  .catch(async err => {
    const hint = describeDbError(err);
    console.error(`[HoursSheet] Failed: ${err.message}`);
    if (hint) console.error(`\n${hint}\n`);
    await pool.end().catch(() => {});
    process.exit(1);
  });
