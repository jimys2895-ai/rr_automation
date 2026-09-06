require('dotenv').config();
const axios = require('axios');

const BASE = 'https://api.gomotive.com';
const KEY  = process.env.MOTIVE_API_KEY;

// Motive reports the driver's timezone as a Rails zone label, which Intl cannot parse.
const IANA_BY_RAILS_ZONE = {
  'Eastern Time (US & Canada)':  'America/Toronto',
  'Central Time (US & Canada)':  'America/Winnipeg',
  'Mountain Time (US & Canada)': 'America/Edmonton',
  'Pacific Time (US & Canada)':  'America/Vancouver',
  'Atlantic Time (Canada)':      'America/Halifax',
  'Newfoundland':                'America/St_Johns',
  'Saskatchewan':                'America/Regina',
  'Arizona':                     'America/Phoenix',
  'Alaska':                      'America/Anchorage',
  'Hawaii':                      'Pacific/Honolulu',
};
const toIana = z => IANA_BY_RAILS_ZONE[z] ?? (/^[A-Za-z]+\/[A-Za-z_]+$/.test(z ?? '') ? z : null);

function headers() {
  if (!KEY) throw new Error('Missing MOTIVE_API_KEY');
  return { 'X-Api-Key': KEY, Accept: 'application/json' };
}

// Motive pages with page_no starting at 1 and reports the total in `pagination`.
async function fetchAll(path, params, pluck) {
  const out = [];
  for (let page = 1; page <= 50; page++) {
    let res;
    try {
      res = await axios.get(`${BASE}${path}`, {
        headers: headers(), params: { ...params, per_page: 100, page_no: page }, timeout: 60_000,
      });
    } catch (err) {
      const detail = JSON.stringify(err.response?.data ?? err.message).slice(0, 300);
      throw new Error(`Motive GET ${path} failed (${err.response?.status}): ${detail}`);
    }
    const batch = (res.data?.[pluck] ?? []).map(x => x[pluck.replace(/s$/, '')] ?? x);
    out.push(...batch);
    const total = res.data?.pagination?.total ?? 0;
    if (out.length >= total || batch.length === 0) break;
  }
  return out;
}

// Active drivers, with the vehicle currently assigned to them where Motive knows it.
async function getDrivers() {
  const users = await fetchAll('/v1/users', { role: 'driver' }, 'users');
  const seen = new Map();
  for (const u of users) if (!seen.has(u.id)) seen.set(u.id, u);
  return [...seen.values()].map(u => ({
    id: u.id,
    name: `${u.first_name ?? ''} ${u.last_name ?? ''}`.replace(/\s+/g, ' ').trim(),
    companyId: u.driver_company_id ?? null,
    status: u.status ?? null,
    active: u.status === 'active',
  }));
}

// Daily HOS logs for the given drivers over a date range. Each log carries the day's
// duty-status events, which is what the hours rule reads, plus shipping_docs — the
// manifest number the driver typed — which we use to confirm the match.
async function getLogs(driverIds, startDate, endDate) {
  if (!driverIds.length) return [];
  const logs = [];
  // The driver_ids filter is repeated per id; keep batches modest so the URL stays sane.
  for (let i = 0; i < driverIds.length; i += 25) {
    const batch = driverIds.slice(i, i + 25);
    logs.push(...await fetchAll('/v1/logs',
      { start_date: startDate, end_date: endDate, 'driver_ids[]': batch }, 'logs'));
  }
  return logs.map(l => ({
    date: l.date,
    driverId: l.driver?.id ?? null,
    driverName: `${l.driver_first_name ?? ''} ${l.driver_last_name ?? ''}`.trim(),
    shippingDocs: l.shipping_docs ?? null,
    vehicleNumbers: l.vehicle_numbers ?? null,
    timeZone: toIana(l.time_zone),
    events: (l.events ?? []).map(e => e.event ?? e),
  }));
}

module.exports = { getDrivers, getLogs, toIana };
