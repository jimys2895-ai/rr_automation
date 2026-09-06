const fs = require('fs');
const { parse } = require('csv-parse/sync');

// Accept either a file path string or raw CSV string content (contains '\n') or Buffer.
function readSource(source, label) {
  if (Buffer.isBuffer(source)) return source.toString('utf8');
  if (typeof source === 'string' && source.includes('\n')) return source; // raw content
  if (!fs.existsSync(source)) {
    console.warn(`[${label}] File not found: ${source} — skipping`);
    return null;
  }
  return fs.readFileSync(source, 'utf8');
}

// Returns Date (midnight UTC) from a date string, or null if unparseable
function parseDate(str) {
  if (!str || !str.trim()) return null;
  const s = str.trim();

  // DD/MM/YYYY HH:MM  (BlueWater) — time component required to distinguish from zero-padded US dates
  const bwMatch = s.match(/^(\d{2})\/(\d{2})\/(\d{4}) \d{2}:\d{2}/);
  if (bwMatch) {
    const [, dd, mm, yyyy] = bwMatch;
    return new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
  }

  // M/D/YYYY or M/D/YY (BVD, EZ Pass) — handles zero-padded months and 2-digit years from Excel
  const usMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (usMatch) {
    const [, m, d, y] = usMatch;
    const yyyy = y.length === 2 ? (parseInt(y) >= 50 ? '19' + y : '20' + y) : y;
    return new Date(`${yyyy}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00Z`);
  }

  // ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s.slice(0, 10) + 'T00:00:00Z');

  return null;
}

function inRange(date, start, end) {
  if (!date || isNaN(date.getTime())) return false;
  const d = date.getTime();
  return d >= start.getTime() && d <= end.getTime();
}

function parseAmount(str) {
  if (str == null || str === '') return NaN;
  return parseFloat(String(str).replace(/[$,\s]/g, '').replace(/\(([^)]+)\)/, '-$1'));
}

// ─── BVD ─────────────────────────────────────────────────────────────────────
// Returns: [{ driverName, unitId, date, finalAmt, discAmt, prod, isCashAdvance }]
//
// A row whose Prod is "C" is a cash advance handed to the driver rather than a fuel
// purchase. It is deducted like any other line, with a flat admin fee on top of it.
//
// Columns are located by HEADER NAME, not fixed position, because BVD exports come
// in two layouts: a trimmed one, and the raw fuel-card export that inserts extra
// HST/GST/PST/QST columns between "Pre Tax AMT" and "Disc Rate" (which would shift
// fixed indices). The header row may also be preceded by title rows.
const CASH_ADVANCE_FEE_USD = 20;

function parseBVD(source, periodStart, periodEnd, currency = '') {
  const label = currency ? `BVD ${currency.toUpperCase()}` : 'BVD';
  const content = readSource(source, label);
  if (!content) return [];

  // relax_column_count: BVD exports pad rows inconsistently — title rows, header, and
  // data rows can each have a different number of columns. Without this, csv-parse throws
  // "Invalid Record Length". Columns are located by header name below, so extra/short
  // rows are handled by index safely.
  const rows = parse(content, { relax_quotes: true, skip_empty_lines: true, relax_column_count: true });

  // Normalize a header cell: lowercase, drop '.'/'#', collapse whitespace.
  const norm = s => String(s ?? '').trim().toLowerCase().replace(/[.#]/g, '').replace(/\s+/g, ' ').trim();

  // Locate the header row (contains "Auth Code" and "Final AMT") and map columns.
  let headerIdx = -1, col = null;
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].map(norm);
    if (cells.includes('auth code') && cells.includes('final amt')) {
      const find = (...names) => {
        for (const n of names) { const idx = cells.indexOf(norm(n)); if (idx >= 0) return idx; }
        return -1;
      };
      col = {
        auth:   find('auth code'),
        driver: find('driver name'),
        unit:   find('unit', 'unit #', 'unit no'),
        date:   find('date'),
        disc:   find('disc amt', 'discount amt', 'disc amount'),
        final:  find('final amt', 'final amount'),
        prod:   find('prod', 'product'),
      };
      headerIdx = i;
      break;
    }
  }

  if (headerIdx < 0 || col.unit < 0 || col.date < 0 || col.final < 0) {
    console.warn(`[${label}] Could not locate BVD header columns (auth/unit/date/final amt) — skipping file`);
    return [];
  }

  const results = [];
  // The auth suffix mirrors the Prod column: TA and DF are fuel, C is a cash advance.
  const AUTH_RE = /^[A-Z]\d+-(TA|DF|C)$/i;
  let skipAuth = 0, skipDate = 0, skipAmt = 0, advances = 0;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row        = rows[i];
    const authCode   = String(row[col.auth] ?? '').trim();
    const driverName = String(row[col.driver] ?? '').trim();
    const unitId     = String(row[col.unit] ?? '').trim();
    const dateStr    = String(row[col.date] ?? '').trim();
    const finalAmt   = parseAmount(row[col.final]);
    const discAmt    = col.disc >= 0 ? parseAmount(row[col.disc]) : 0;
    const prod       = col.prod >= 0 ? String(row[col.prod] ?? '').trim().toUpperCase() : '';

    if (!AUTH_RE.test(authCode)) { skipAuth++; continue; }
    if (!driverName || !unitId) continue;
    if (isNaN(finalAmt) || finalAmt <= 0) { skipAmt++; continue; }

    const date = parseDate(dateStr);
    if (!inRange(date, periodStart, periodEnd)) { skipDate++; continue; }

    const disc = isNaN(discAmt) ? 0 : discAmt;
    // Fall back to the auth suffix where the export has no Prod column.
    const isCashAdvance = prod === 'C' || /-C$/i.test(authCode);
    if (isCashAdvance) advances++;
    results.push({ driverName: driverName.toUpperCase(), unitId, date, finalAmt, discAmt: disc, prod, isCashAdvance });
  }

  console.log(`[${label}] Parsed ${results.length} transactions in period`
    + (advances ? `, ${advances} of them cash advances` : '')
    + `. (skipped — auth:${skipAuth} date:${skipDate} amt:${skipAmt})`);
  return results;
}

// ─── EASYPASS ────────────────────────────────────────────────────────────────
// Returns: [{ unitId, date, amountUsd }]
function parseEasyPass(source, periodStart, periodEnd, currency = '') {
  const label = currency ? `EZ Pass ${currency.toUpperCase()}` : 'EZ Pass';
  const content = readSource(source, label);
  if (!content) return [];

  const rows = parse(content, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true });

  const results = [];
  let skipDate = 0, skipUnit = 0, skipAmt = 0;
  for (const row of rows) {
    // Use Exit Date as the charge date; fall back to Entry Date, then Post Date
    const dateStr = row['Exit Date'] || row['Entry Date'] || row['Post Date'] || '';
    const date    = parseDate(dateStr);
    if (!inRange(date, periodStart, periodEnd)) { skipDate++; continue; }

    const unitId = String(row['Unit'] ?? '').trim();
    if (!unitId) { skipUnit++; continue; }

    // Use Amount column (same as Discounted Amount for most rows)
    const amount = parseAmount(row['Amount']);
    if (isNaN(amount) || amount <= 0) { skipAmt++; continue; }

    results.push({ unitId, date, amountUsd: amount });
  }

  console.log(`[${label}] Parsed ${results.length} transactions in period. (skipped — date:${skipDate} unit:${skipUnit} amt:${skipAmt})`);
  return results;
}

// ─── BLUEWATER ───────────────────────────────────────────────────────────────
// currency: 'usd' or 'cad'
// Returns: [{ transponder, date, amount }]
function parseBlueWater(source, currency, periodStart, periodEnd) {
  const content = readSource(source, `BlueWater ${currency.toUpperCase()}`);
  if (!content) return [];

  const rows = parse(content, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true });

  const results = [];
  let skipTxp = 0, skipDate = 0, skipAmt = 0;
  for (const row of rows) {
    const transponder = String(row['Transponder'] ?? '').trim();
    if (!transponder) { skipTxp++; continue; }

    const dateStr = row['Transaction DateTime'] || '';
    const date    = parseDate(dateStr);
    if (!inRange(date, periodStart, periodEnd)) { skipDate++; continue; }

    // Amount is negative (e.g. -$26.25); take absolute value for the deduction
    const raw    = parseAmount(row['Amount']);
    const amount = Math.abs(raw);
    if (isNaN(amount) || amount <= 0) { skipAmt++; continue; }

    results.push({ transponder, date, amount });
  }

  console.log(`[BlueWater ${currency.toUpperCase()}] Parsed ${results.length} transactions in period. (skipped — txp:${skipTxp} date:${skipDate} amt:${skipAmt})`);
  return results;
}

// ─── Aggregation helpers ──────────────────────────────────────────────────────
//
// Each aggregator converts every row at the closing rate for ITS OWN transaction
// date (rateFor(date)) and returns per-key running totals:
//   { usd, cad, byDate: Map<'YYYY-MM-DD', { usd, cad, rate }> }
//   usd = Σ native amount (source-currency total, for display)
//   cad = Σ native amount × rateFor(date)  (per-day converted, summed)
//   byDate = the same totals broken down per transaction date, with the rate used.
// Totals are left UNROUNDED here; the server rounds once when building the charge.
// rateFor defaults to () => 1, so CAD-native files (and tests) pass straight through
// with cad === usd and no conversion applied.

function dateKey(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

// Accumulate one row's native value into a { usd, cad, byDate } entry.
function accumulate(map, key, value, date, rateFor) {
  const rate = rateFor(date);
  const cad  = value * rate;
  const e = map.get(key) ?? { usd: 0, cad: 0, byDate: new Map() };
  e.usd += value;
  e.cad += cad;
  const dk = dateKey(date);
  const d = e.byDate.get(dk) ?? { usd: 0, cad: 0, rate };
  d.usd += value;
  d.cad += cad;
  e.byDate.set(dk, d);
  map.set(key, e);
}

// Sum BVD amounts per driver unit. Per row the source value is finalAmt + 20%×discAmt,
// plus a flat admin fee on a cash advance. Keeping it unrounded until the final per-charge
// round avoids per-row drift.
//
// The fee is in US dollars and is charged once per advance, so three advances in a period
// carry three fees. It rides the same daily conversion as the amount it sits beside, which
// is right because cash advances only ever appear in the USD export.
function aggregateBVD(rows, rateFor = () => 1) {
  const map = new Map(); // unitId → { usd, cad, byDate }
  for (const r of rows) {
    const fee = r.isCashAdvance ? CASH_ADVANCE_FEE_USD : 0;
    accumulate(map, r.unitId, r.finalAmt + 0.20 * r.discAmt + fee, r.date, rateFor);
  }
  return map;
}

// Sum EZ Pass amounts per unit (unitId → { usd, cad, byDate })
function aggregateEasyPass(rows, rateFor = () => 1) {
  const map = new Map();
  for (const r of rows) accumulate(map, r.unitId, r.amountUsd, r.date, rateFor);
  return map;
}

// Sum BlueWater amounts per transponder (transponder → { usd, cad, byDate })
function aggregateBlueWater(rows, rateFor = () => 1) {
  const map = new Map();
  for (const r of rows) accumulate(map, r.transponder, r.amount, r.date, rateFor);
  return map;
}

module.exports = {
  CASH_ADVANCE_FEE_USD,
  parseBVD,
  parseEasyPass,
  parseBlueWater,
  aggregateBVD,
  aggregateEasyPass,
  aggregateBlueWater,
};
