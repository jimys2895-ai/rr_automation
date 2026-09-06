#!/usr/bin/env node
// Run the fuel surcharge sync by hand. Reads both publishers, takes whichever has the
// newest week, and writes the LTL and TL rates into each RoseRocket org. A rate that
// already matches is left alone.
//
//   npm run sync:fuel              apply to every org
//   npm run sync:fuel -- --dry     report what it would do, writing nothing
//   npm run sync:fuel -- CET       one org only (CET or CEL)
//
// Needs no database, so it runs even where Postgres is unavailable.
require('dotenv').config();
const { runFuelSurchargeSync, ORGS } = require('../src/fuelSurcharge');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry') || args.includes('--dry-run');
const onlyOrg = args.map(a => a.toUpperCase()).find(a => ORGS.some(o => o.label === a)) ?? null;

const unknown = args.filter(a => !/^--/.test(a) && a.toUpperCase() !== onlyOrg);
if (unknown.length) {
  console.error(`Unrecognised argument: ${unknown.join(', ')}. Expected --dry or an org (${ORGS.map(o => o.label).join(', ')}).`);
  process.exit(2);
}

runFuelSurchargeSync({ dryRun, onlyOrg })
  .then(summary => {
    const width = Math.max(...summary.results.flatMap(r => (r.items ?? []).map(i => String(i.name).length)), 8);
    console.log(`\nWeek of ${summary.weekStartingDate}, from ${summary.source}: LTL ${summary.ltl}%, TL ${summary.tl}%`);
    for (const org of summary.results) {
      if (org.error) { console.log(`  ${org.org}  FAILED  ${org.error}`); continue; }
      for (const item of org.items) {
        const change = item.from === undefined ? `${item.base_rate}%` : `${item.from}% -> ${item.base_rate}%`;
        console.log(`  ${org.org.padEnd(4)} ${String(item.name).padEnd(width)}  ${item.action.padEnd(12)} ${change}`);
      }
    }
    if (dryRun) console.log('\nDry run: nothing was written.');
    process.exit(summary.results.some(r => r.error) ? 1 : 0);
  })
  .catch(err => {
    console.error('[FuelSurcharge] Failed:', err.message);
    process.exit(1);
  });
