const axios = require('axios');

const SERIES   = 'FXUSDCAD';        // Bank of Canada daily average USD→CAD
const MARKUP   = 0.02;              // flat markup added to each day's closing rate
const CACHE_MS = 60 * 60 * 1000;    // 1 hour
const cache    = new Map();         // "fetchStart:end" → { table, fetchedAt }

// Format a Date (UTC midnight) or 'YYYY-MM-DD' string to 'YYYY-MM-DD'.
function fmt(date) {
  return date instanceof Date ? date.toISOString().slice(0, 10) : String(date).slice(0, 10);
}

// Fetch Bank of Canada daily USD→CAD closing rates for the pay period and return a
// lookup keyed by transaction date. Each rate has the +0.02 markup pre-applied.
//
// BoC publishes only on business days, so a transaction dated on a weekend/holiday
// falls back to the most recent prior published rate ("closing rate on that day").
//
// Returns { rateFor(date), min, max, count } where rateFor accepts a Date or 'YYYY-MM-DD'.
async function getRateTable(payPeriodStart, payPeriodEnd) {
  const start = fmt(payPeriodStart);
  const end   = fmt(payPeriodEnd);

  // Widen the fetch window back 10 days so early-period weekend/holiday charges
  // always have a prior business-day rate to fall back to.
  const fetchStart = fmt(new Date(new Date(`${start}T00:00:00Z`).getTime() - 10 * 86_400_000));

  const key = `${fetchStart}:${end}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < CACHE_MS) return hit.table;

  let res;
  try {
    res = await axios.get(`https://www.bankofcanada.ca/valet/observations/${SERIES}/json`, {
      params: { start_date: fetchStart, end_date: end },
      timeout: 15000,
    });
  } catch (e) {
    throw new Error(`Could not fetch Bank of Canada USD/CAD rates: ${e.message}`);
  }

  // Observations: [{ d: '2026-06-08', FXUSDCAD: { v: '1.3947' } }, ...]
  const entries = (res.data?.observations ?? [])
    .map(o => [o.d, parseFloat(o[SERIES]?.v)])
    .filter(([d, v]) => d && !isNaN(v))
    .map(([d, v]) => [d, Math.round((v + MARKUP) * 10000) / 10000])   // apply markup, 4dp
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));                          // ascending by date

  if (!entries.length) {
    throw new Error(`Bank of Canada returned no USD/CAD observations for ${fetchStart} → ${end}`);
  }

  const dates  = entries.map(e => e[0]);
  const rates  = entries.map(e => e[1]);
  const byDate = new Map(entries);

  // Rate for a date: exact match, else most recent prior published business day.
  function rateFor(date) {
    const d = fmt(date);
    if (byDate.has(d)) return byDate.get(d);
    // Binary search for the latest observation date <= d.
    let lo = 0, hi = dates.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (dates[mid] <= d) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans >= 0 ? rates[ans] : rates[0]; // before all data → earliest available
  }

  const table = { rateFor, min: Math.min(...rates), max: Math.max(...rates), count: entries.length };
  cache.set(key, { table, fetchedAt: Date.now() });
  console.log(`[Exchange] BoC USD/CAD ${fetchStart}→${end}: ${entries.length} days, +${MARKUP} markup, range ${table.min}–${table.max}`);
  return table;
}

module.exports = { getRateTable };
