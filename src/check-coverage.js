require('dotenv').config();
const path = require('path');
const fs   = require('fs');
const axios = require('axios');
const { getToken } = require('./auth');

function normalizeBillName(name) {
  return String(name ?? '')
    .toUpperCase()
    .split(/\s+C\/O\b/)[0]
    .replace(/\s+/g, ' ')
    .trim();
}

function loadJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

const BASE_URL = (process.env.ROSEROCKET_ORG_URL || '').replace(/\/+$/, '');

async function run() {
  const driverMap = loadJson(path.join(__dirname, '..', 'config', 'driver-map.json'));

  const nameToUnit = new Map();
  for (const [unitId, info] of Object.entries(driverMap)) {
    nameToUnit.set(normalizeBillName(info.name), unitId);
  }

  const token = await getToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'x-requested-with': 'XMLHttpRequest',
  };

  // Collect unique driverIds from all driver_settlement listings
  let allSettlements = [], page = 0;
  while (true) {
    const res = await axios.get(`${BASE_URL}/api/v1/consolidated_bills`, { headers, params: { limit: 200, offset: page * 200 } });
    const s = res.data?.data?.settlements ?? [];
    allSettlements = allSettlements.concat(s.filter(x => x.consolidatedBillTypeId === 'driver_settlement'));
    if (s.length < 200) break;
    page++;
  }

  // Collect unique driverIds → fetch one bill each to get the driver name
  const driverBillMap = new Map();
  for (const s of allSettlements) {
    if (s.driverId && !driverBillMap.has(s.driverId)) driverBillMap.set(s.driverId, s.id);
  }

  const seen = new Map(); // normalizedName → { raw, driverId, matched, unitId }
  for (const [driverId, billId] of driverBillMap) {
    const r = await axios.get(`${BASE_URL}/api/v1/consolidated_bills/${billId}`, { headers });
    const cb = r.data?.data?.consolidated_bill;
    const raw  = cb?.bill_to_company_name ?? '';
    if (!raw) continue;
    const norm = normalizeBillName(raw);
    const unitId = nameToUnit.get(norm);
    seen.set(norm, { raw, driverId, matched: !!unitId, unitId });
  }

  const matched   = [...seen.values()].filter(v => v.matched).sort((a,b) => a.raw.localeCompare(b.raw));
  const unmatched = [...seen.values()].filter(v => !v.matched).sort((a,b) => a.raw.localeCompare(b.raw));

  console.log(`\n=== Driver Coverage Check ===`);
  console.log(`Unique drivers in RoseRocket: ${seen.size}`);

  console.log(`\n✓ Covered (${matched.length}):`);
  matched.forEach(v => console.log(`   Unit ${v.unitId}  ${v.raw}`));

  console.log(`\n✗ NOT in driver-map.json (${unmatched.length}) — likely inactive or non-company drivers:`);
  if (unmatched.length === 0) {
    console.log('   (none)');
  } else {
    unmatched.forEach(v => console.log(`   driverId: ${v.driverId}  |  "${v.raw}"`));
  }
}

run().catch(err => { console.error('[ERROR]', err.message); process.exit(1); });
