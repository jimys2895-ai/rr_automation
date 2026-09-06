require('dotenv').config();
const axios = require('axios');
const { getToken } = require('./auth');

// Two publishers of the same weekly surcharge schedule. Their numbers agree week for week;
// they differ only in when each posts. Speedy is a JSON feed, Trappers is a table on a
// page. Reading both means a late post from one does not hold up the rate.
const SPEEDY_URL   = 'https://api.speedy.ca/api/SpeedyCa/Pa/GetFuelSurcharge';
const TRAPPERS_URL = 'https://trapperstransport.com/resources/resources-for-customers/fuel-surcharges/';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
                'july', 'august', 'september', 'october', 'november', 'december'];

// Target orgs and the fuel record each rate maps to, BY NAME.
// The same login authenticates all orgs; each gets its own org-scoped token via getToken(url).
// TL is named differently per org: "F/L FUEL" in CET, "TL" in CEL. LTL is "LTL" in both.
const ORGS = [
  { label: 'CET', url: 'https://cetrucking.roserocket.com',  names: { ltl: 'LTL', tl: 'F/L FUEL' } },
  { label: 'CEL', url: 'https://celogistics.roserocket.com', names: { ltl: 'LTL', tl: 'TL' } },
];

// "35.4%" → 35.4
function parsePct(v) {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? null : n;
}

// Speedy publishes JSON, newest week first.
async function fetchSpeedyWeeks() {
  const res = await axios.get(SPEEDY_URL, { timeout: 15000 });
  const rows = Array.isArray(res.data) ? res.data : [];
  return rows
    .map(r => ({ weekStartingDate: String(r.weekStartingDate ?? '').slice(0, 10), ltl: parsePct(r.ltl), tl: parsePct(r.tl) }))
    .filter(w => /^\d{4}-\d{2}-\d{2}$/.test(w.weekStartingDate) && w.ltl != null && w.tl != null);
}

// Trappers publishes a table: Date | LTL | FTL (Tandem) | FTL (Tridem). Tandem is the TL
// rate; the tridem column is not used here.
async function fetchTrappersWeeks() {
  const res = await axios.get(TRAPPERS_URL, { timeout: 15000, headers: { 'User-Agent': 'rr-automation' } });
  const text = String(res.data)
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');

  const weeks = [];
  const row = /([A-Z][a-z]+)\s+(\d{1,2})\s*,\s*(\d{4})\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/g;
  for (const m of text.matchAll(row)) {
    const month = MONTHS.indexOf(m[1].toLowerCase());
    if (month < 0) continue;
    weeks.push({
      weekStartingDate: `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`,
      ltl: parsePct(m[4]),
      tl: parsePct(m[5]),
    });
  }
  return weeks;
}

// Take whichever source has the newest week. Where both carry it they agree, so a
// disagreement means one of them has changed and is worth saying out loud rather than
// quietly picking a winner.
async function fetchLatestSurcharge() {
  const sources = [
    { name: 'speedy.ca', load: fetchSpeedyWeeks },
    { name: 'trapperstransport.com', load: fetchTrappersWeeks },
  ];

  const found = [];
  const failures = [];
  for (const source of sources) {
    try {
      const weeks = await source.load();
      if (!weeks.length) throw new Error('no usable rows');
      weeks.sort((a, b) => (a.weekStartingDate < b.weekStartingDate ? 1 : -1));
      found.push({ source: source.name, ...weeks[0] });
    } catch (e) {
      failures.push(`${source.name}: ${e.message}`);
      console.warn(`[FuelSurcharge] ${source.name} unavailable: ${e.message}`);
    }
  }
  if (!found.length) throw new Error(`No fuel surcharge source could be read. ${failures.join('; ')}`);

  found.sort((a, b) => (a.weekStartingDate < b.weekStartingDate ? 1 : -1));
  const best = found[0];

  const rival = found.find(f => f !== best && f.weekStartingDate === best.weekStartingDate);
  if (rival && (rival.ltl !== best.ltl || rival.tl !== best.tl)) {
    console.warn(`[FuelSurcharge] Sources disagree for week ${best.weekStartingDate}: `
      + `${best.source} ${best.ltl}/${best.tl} vs ${rival.source} ${rival.ltl}/${rival.tl}. Using ${best.source}.`);
  }
  return best;
}

async function orgHeaders(orgUrl) {
  const token = await getToken(orgUrl);
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'x-requested-with': 'XMLHttpRequest',
  };
}

// Decide (and optionally perform) the upsert for one fuel record.
// Update in place by id if it exists, else create. No-op when the rate already matches.
async function upsertFuel(orgUrl, headers, existing, name, baseRate, dryRun) {
  const cur = existing.find(f => f.name === name);
  if (cur) {
    if (Number(cur.base_rate) === Number(baseRate)) {
      return { name, action: 'unchanged', base_rate: baseRate };
    }
    if (!dryRun) {
      await axios.put(`${orgUrl}/api/v1/org_fuel/${cur.id}`,
        { name: cur.name, base_rate: baseRate, category: cur.category || 'basic' },
        { headers });
    }
    return { name, action: dryRun ? 'would update' : 'updated', from: cur.base_rate, base_rate: baseRate };
  }
  if (!dryRun) {
    await axios.post(`${orgUrl}/api/v1/org_fuel`,
      { name, base_rate: baseRate, category: 'basic' },
      { headers });
  }
  return { name, action: dryRun ? 'would create' : 'created', base_rate: baseRate };
}

async function syncOrg(org, rates, dryRun) {
  const headers = await orgHeaders(org.url);
  const listRes = await axios.get(`${org.url}/api/v1/org_fuel`, { headers, params: { limit: 100 } });
  const existing = listRes.data?.data?.org_fuel ?? [];
  const items = [
    await upsertFuel(org.url, headers, existing, org.names.ltl, rates.ltl, dryRun),
    await upsertFuel(org.url, headers, existing, org.names.tl,  rates.tl,  dryRun),
  ];
  return { org: org.label, items };
}

// Fetch the latest surcharge and push it into every configured org.
// dryRun=true reports intended actions without writing anything.
async function runFuelSurchargeSync({ dryRun = false, onlyOrg = null } = {}) {
  const rates = await fetchLatestSurcharge();
  const targets = onlyOrg ? ORGS.filter(o => o.label === onlyOrg) : ORGS;
  if (onlyOrg && !targets.length) throw new Error(`Unknown org '${onlyOrg}'. Known: ${ORGS.map(o => o.label).join(', ')}`);
  const results = [];
  for (const org of targets) {
    try {
      results.push(await syncOrg(org, rates, dryRun));
    } catch (e) {
      const detail = e.response ? `${e.response.status}: ${JSON.stringify(e.response.data).slice(0, 200)}` : e.message;
      results.push({ org: org.label, error: detail });
    }
  }
  const summary = {
    ranAt: new Date().toISOString(),
    dryRun,
    source: rates.source,
    weekStartingDate: rates.weekStartingDate,
    ltl: rates.ltl,
    tl: rates.tl,
    results,
  };
  console.log(`[FuelSurcharge] ${dryRun ? 'DRY-RUN' : 'SYNC'} week ${rates.weekStartingDate} from ${rates.source}: LTL ${rates.ltl}% / TL ${rates.tl}% ->`,
    results.map(r => r.error ? `${r.org}:ERR` : `${r.org}:[${r.items.map(i => i.action).join(',')}]`).join(' '));
  return summary;
}

module.exports = { runFuelSurchargeSync, fetchLatestSurcharge, fetchSpeedyWeeks, fetchTrappersWeeks, ORGS };
