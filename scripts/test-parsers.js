require('dotenv').config();
const fs = require('fs');
const { parseBVD, parseEasyPass, parseBlueWater, aggregateBVD, aggregateEasyPass, aggregateBlueWater } = require('../src/parsers');

// Sample exports are not kept in the repo; they hold real customer data. Drop a set into
// input/ to run these checks, and each section skips cleanly when its file is absent
// rather than reporting a wall of failures against no data.
const sample = name => `${__dirname}/../input/${name}`;
const missing = path => !fs.existsSync(path);

// BVD sample covers June 9-15
const BVD_START = new Date('2026-06-09T00:00:00Z');
const BVD_END   = new Date('2026-06-15T00:00:00Z');

// EZ Pass sample has Exit Dates from April 29 - May 8
const EP_START = new Date('2026-04-29T00:00:00Z');
const EP_END   = new Date('2026-05-08T00:00:00Z');

// BlueWater samples cover June 4-11; use June 6-11 to test boundary handling
const BW_START = new Date('2026-06-06T00:00:00Z');
const BW_END   = new Date('2026-06-11T00:00:00Z');

// ─── BVD ─────────────────────────────────────────────────────────────────────
// Expected totals per unit from the sample CSV:
// Expected totals use formula: finalAmt + 20% × discAmt per row, plus a $20 admin fee on
// each cash advance (a row whose Prod is "C").
const BVD_EXPECTED = {
  '9688': 1273.11,  // MIROSLAW KOPYLEC   (426.58 + 626.53 + a $200 advance + $20 fee)
  '9682': 1642.70,  // JEFFREY GILL       (711.89 + 566.27 + 364.54)
  '9693':  458.89,  // ROBERT BRONOWICKI
  '1543':  728.57,  // LAWARENCE DOWNEY   (325.26 + 403.31)
  '9673':  610.18,  // TAMAS RATI         (274.45 + 52.18 + 263.90 + 19.65)
  '9689': 1838.94,  // PAWEL TROCHA       (785.83 + 368.07 + 685.04)
  '1544': 1366.02,  // KEVIN HOBBS        (673.78 + 692.24)
  '9687': 1083.61,  // ADAM KARPINSKI     (330.91 + 752.70)
  '1529': 1048.20,  // ALEXANDRE RAMOS    (402.04 + 646.16)
  '9691':  938.98,  // MIROSLAW KRZYZANOWSKI (264.15 + 674.83)
  '9681':  558.68,  // MICHAEL LUMLEY
  '9690':  849.15,  // JANUSZ KUKIELKA
};

function runBvd() {
  const samplePath = sample('BVD USD June 9-15.csv');
  if (missing(samplePath)) return console.log('  BVD: SKIPPED, no sample file in input/\n');
  const rows = parseBVD(samplePath, BVD_START, BVD_END);
  const map  = aggregateBVD(rows);

  let pass = 0, fail = 0;
  for (const [uid, expected] of Object.entries(BVD_EXPECTED)) {
    const actual = Math.round((map.get(uid)?.usd ?? 0) * 100) / 100;
    const ok = Math.abs(actual - expected) < 0.01;
    console.log(`  BVD ${uid}: ${ok ? '✓' : '✗'} expected ${expected}, got ${actual}`);
    ok ? pass++ : fail++;
  }
  const extra = [...map.keys()].filter(k => !BVD_EXPECTED[k]);
  if (extra.length) console.log(`  BVD EXTRA units not in expected: ${extra.join(', ')}`);
  console.log(`  BVD result: ${pass} passed, ${fail} failed\n`);
}

// ─── EZ Pass ─────────────────────────────────────────────────────────────────
function runEasyPass() {
  const samplePath = sample('EasyPass sample.csv');
  if (missing(samplePath)) return console.log('  EZ Pass: SKIPPED, no sample file in input/\n');
  try {
    const rows = parseEasyPass(samplePath, EP_START, EP_END);
    const map  = aggregateEasyPass(rows);
    console.log(`  EZ Pass: parsed ${rows.length} rows, ${map.size} units`);
    for (const [uid, total] of map) {
      console.log(`    Unit ${uid}: $${total.usd.toFixed(2)}`);
    }
  } catch (e) {
    console.log(`  EZ Pass: SKIPPED — no sample file (${e.message})`);
  }
  console.log();
}

// ─── BlueWater ───────────────────────────────────────────────────────────────
function runBlueWater() {
  for (const cur of ['usd', 'cad']) {
    const samplePath = sample(`BlueWater ${cur.toUpperCase()} sample.csv`);
    if (missing(samplePath)) { console.log(`  BlueWater ${cur.toUpperCase()}: SKIPPED, no sample file in input/`); continue; }
    try {
      const rows = parseBlueWater(samplePath, cur, BW_START, BW_END);
      const map  = aggregateBlueWater(rows);
      console.log(`  BlueWater ${cur.toUpperCase()}: parsed ${rows.length} rows, ${map.size} transponders`);
      for (const [txp, total] of map) {
        console.log(`    Transponder ${txp}: $${total.usd.toFixed(2)}`);
      }
    } catch (e) {
      console.log(`  BlueWater ${cur.toUpperCase()}: SKIPPED — no sample file (${e.message})`);
    }
  }
  console.log();
}

console.log('=== Parser Tests ===\n');
runBvd();
runEasyPass();
runBlueWater();
