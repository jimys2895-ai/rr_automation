require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const multer  = require('multer');
const path    = require('path');
const axios   = require('axios');
const { v4: uuidv4 } = require('uuid');
const XLSX    = require('xlsx');

const { pool, initDb, describeDbError } = require('./db');
require('./src/auth');
const { getRateTable } = require('./src/exchange');
const { parseBVD, parseEasyPass, parseBlueWater,
        aggregateBVD, aggregateEasyPass, aggregateBlueWater,
        CASH_ADVANCE_FEE_USD } = require('./src/parsers');
const { getConsolidatedBills, getSubBill, updateConsolidatedBill } = require('./src/roserocket');
const { runFuelSurchargeSync } = require('./src/fuelSurcharge');
const { buildPreview } = require('./src/hoursSync');
const { formatDuration } = require('./src/hours');
const { syncHoursSheet } = require('./src/hoursSheet');
const { updateManifestDuration } = require('./src/manifests');
const { buildPairing, setLink, setEnabled } = require('./src/driverMap');
const cron = require('node-cron');

const app    = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const wrap   = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const jobs   = new Map(); // jobId → { items, createdAt }
const hoursJobs = new Map(); // jobId → { rows, createdAt }

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'client/dist')));

// ─── Constants ────────────────────────────────────────────────────────────────

const BILL_ITEM_TYPES = {
  BVD_FUEL: '1abef744-c7b3-4619-8f45-ca52fb371db7',
  TOLL:     'de57b06d-66ec-4d9d-85cb-6b60b95a3220',
};
const DESCS = {
  BVD_FUEL_USD:  'BVD Fuel USD',
  BVD_FUEL_CAD:  'BVD Fuel CAD',
  EASYPASS_USD:  'EZ Pass USD',
  EASYPASS_CAD:  'EZ Pass CAD',
  BLUEWATER_USD: 'BlueWater USD',
  BLUEWATER_CAD: 'BlueWater CAD',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toTitleCase(name) {
  return String(name ?? '').trim().replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

function normalizeName(name) {
  return String(name ?? '').toUpperCase().split(/\s+C\/O\b/)[0].replace(/\s+/g, ' ').trim();
}

function fileToString(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === '.xlsx' || ext === '.xls') {
    const wb = XLSX.read(file.buffer, { type: 'buffer', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_csv(ws);
  }
  return file.buffer.toString('utf8');
}

const round2 = n => Math.round(n * 100) / 100;

function buildItem(typeId, desc, amountCad) {
  const v = Math.round(amountCad * 100) / 100;
  return {
    description: desc, quantity: 1, unit_price: -v, price: 0,
    tax: {}, bill_item_type: {}, bill_item_id: '',
    bill_item_type_id: typeId, total_amount: -v, overagePrice: null,
  };
}

// Expire jobs older than 1 hour
setInterval(() => {
  const cut = Date.now() - 3_600_000;
  for (const [id, j] of jobs) if (j.createdAt < cut) jobs.delete(id);
  for (const [id, j] of hoursJobs) if (j.createdAt < cut) hoursJobs.delete(id);
}, 600_000);

// ─── Drivers ──────────────────────────────────────────────────────────────────

app.get('/api/drivers', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT unit_id, rr_id, name FROM driver_map
     ORDER BY
       CASE WHEN unit_id ~ '^[0-9]+$' THEN CAST(unit_id AS INTEGER) END,
       unit_id`
  );
  res.json(rows);
}));

app.post('/api/drivers', wrap(async (req, res) => {
  const { unit_id, rr_id = '', name } = req.body;
  if (!unit_id?.trim() || !name?.trim()) return res.status(400).json({ error: 'unit_id and name are required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO driver_map(unit_id, rr_id, name) VALUES($1,$2,$3) RETURNING *',
      [unit_id.trim(), (rr_id || '').trim(), toTitleCase(name)]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Unit ID already exists' });
    throw e;
  }
}));

app.put('/api/drivers/:unitId', wrap(async (req, res) => {
  const { rr_id = '', name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  const { rows } = await pool.query(
    'UPDATE driver_map SET rr_id=$1, name=$2 WHERE unit_id=$3 RETURNING *',
    [(rr_id || '').trim(), toTitleCase(name), req.params.unitId]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
}));

app.delete('/api/drivers/:unitId', wrap(async (req, res) => {
  await pool.query('DELETE FROM driver_map WHERE unit_id=$1', [req.params.unitId]);
  res.json({ ok: true });
}));

app.delete('/api/drivers', wrap(async (req, res) => {
  const { unitIds, all } = req.body ?? {};
  if (all) {
    await pool.query('DELETE FROM driver_map');
  } else if (Array.isArray(unitIds) && unitIds.length) {
    await pool.query('DELETE FROM driver_map WHERE unit_id = ANY($1)', [unitIds]);
  } else {
    return res.status(400).json({ error: 'Provide unitIds array or all: true' });
  }
  res.json({ ok: true });
}));

// ─── Transponders ─────────────────────────────────────────────────────────────

app.get('/api/transponders', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT transponder, unit_id FROM transponder_map ORDER BY unit_id, transponder');
  res.json(rows);
}));

app.post('/api/transponders', wrap(async (req, res) => {
  const { transponder, unit_id } = req.body;
  if (!transponder?.trim() || !unit_id?.trim()) return res.status(400).json({ error: 'transponder and unit_id are required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO transponder_map(transponder, unit_id) VALUES($1,$2) RETURNING *',
      [transponder.trim(), unit_id.trim()]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Transponder already exists' });
    throw e;
  }
}));

app.put('/api/transponders/:id', wrap(async (req, res) => {
  const oldKey = decodeURIComponent(req.params.id);
  const { unit_id } = req.body;
  if (!unit_id?.trim()) return res.status(400).json({ error: 'unit_id is required' });
  const { rows } = await pool.query(
    'UPDATE transponder_map SET unit_id=$1 WHERE transponder=$2 RETURNING *',
    [unit_id.trim(), oldKey]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
}));

app.delete('/api/transponders/:id', wrap(async (req, res) => {
  await pool.query('DELETE FROM transponder_map WHERE transponder=$1', [decodeURIComponent(req.params.id)]);
  res.json({ ok: true });
}));

app.delete('/api/transponders', wrap(async (req, res) => {
  const { transponders, all } = req.body ?? {};
  if (all) {
    await pool.query('DELETE FROM transponder_map');
  } else if (Array.isArray(transponders) && transponders.length) {
    await pool.query('DELETE FROM transponder_map WHERE transponder = ANY($1)', [transponders]);
  } else {
    return res.status(400).json({ error: 'Provide transponders array or all: true' });
  }
  res.json({ ok: true });
}));

// ─── Debug ────────────────────────────────────────────────────────────────────

app.get('/api/debug/bill-item-types', wrap(async (req, res) => {
  const { getToken } = require('./src/auth');
  const token = await getToken();
  const orgUrl = (process.env.ROSEROCKET_ORG_URL || '').replace(/\/+$/, '');
  const r = await axios.get(`${orgUrl}/api/v1/bill_item_types`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
  });
  res.json(r.data);
}));

// ─── Process ──────────────────────────────────────────────────────────────────

app.post('/api/process', upload.fields([
  { name: 'bvdUsd',       maxCount: 20 },
  { name: 'bvdCad',       maxCount: 20 },
  { name: 'easypassUsd',  maxCount: 20 },
  { name: 'easypassCad',  maxCount: 20 },
  { name: 'bluewaterUsd', maxCount: 20 },
  { name: 'bluewaterCad', maxCount: 20 },
]), wrap(async (req, res) => {
  const { payPeriodStart, payPeriodEnd } = req.body;
  if (!payPeriodStart || !payPeriodEnd) return res.status(400).json({ error: 'payPeriodStart and payPeriodEnd required' });

  const periodStart = new Date(`${payPeriodStart}T00:00:00Z`);
  const periodEnd   = new Date(`${payPeriodEnd}T00:00:00Z`);
  const files       = req.files || {};
  const warnings    = [];

  // Load maps from DB
  const { rows: driverRows } = await pool.query('SELECT unit_id, rr_id AS id, name FROM driver_map');
  const { rows: txpRows    } = await pool.query('SELECT transponder, unit_id FROM transponder_map');
  const driverMap      = Object.fromEntries(driverRows.map(r => [r.unit_id, { id: r.id, name: r.name }]));
  const transponderMap = Object.fromEntries(txpRows.map(r => [r.transponder, r.unit_id]));
  const nameToUnit     = new Map(Object.entries(driverMap).map(([uid, info]) => [normalizeName(info.name), uid]));

  // Parse uploaded files. Each slot may hold multiple files (e.g. 2-3 BVD USD exports);
  // parse each and concatenate the rows — aggregation below sums per unit/transponder.
  const parseAll = (fileArr, parseFn) => (fileArr ?? []).flatMap(f => parseFn(fileToString(f)));

  const bvdUsdRows = parseAll(files.bvdUsd,       s => parseBVD(s, periodStart, periodEnd, 'usd'));
  const bvdCadRowsRaw = parseAll(files.bvdCad,    s => parseBVD(s, periodStart, periodEnd, 'cad'));

  // Cash advances are drawn in the States, so they only ever turn up in the USD export.
  // One in a CAD file would mean the admin fee needs converting on its own while the
  // advance does not, which is not a guess worth making unprompted.
  const cadAdvances = bvdCadRowsRaw.filter(r => r.isCashAdvance);
  const bvdCadRows  = bvdCadRowsRaw.filter(r => !r.isCashAdvance);
  if (cadAdvances.length) {
    warnings.push(`BVD CAD: ${cadAdvances.length} cash advance row(s) found in a Canadian file, which is not expected. `
      + `They have been left out: ${cadAdvances.map(r => `unit ${r.unitId} $${r.finalAmt.toFixed(2)}`).join(', ')}.`);
  }

  // Advances are folded into the fuel line, so the only way to see them is to say so.
  const usdAdvances = bvdUsdRows.filter(r => r.isCashAdvance);
  if (usdAdvances.length) {
    const drawn = usdAdvances.reduce((sum, r) => sum + r.finalAmt, 0);
    const fees  = usdAdvances.length * CASH_ADVANCE_FEE_USD;
    warnings.push(`BVD USD: ${usdAdvances.length} cash advance(s) totalling $${drawn.toFixed(2)} USD, `
      + `plus $${fees.toFixed(2)} in admin fees, are included in the BVD Fuel USD line.`);
  }
  const ezUsdRows  = parseAll(files.easypassUsd,  s => parseEasyPass(s, periodStart, periodEnd, 'usd'));
  const ezCadRows  = parseAll(files.easypassCad,  s => parseEasyPass(s, periodStart, periodEnd, 'cad'));
  const bwUsdRows  = parseAll(files.bluewaterUsd, s => parseBlueWater(s, 'usd', periodStart, periodEnd));
  const bwCadRows  = parseAll(files.bluewaterCad, s => parseBlueWater(s, 'cad', periodStart, periodEnd));

  // Bank of Canada daily rates for the period — each USD row converts at its own
  // transaction-date closing rate (+0.02). CAD-native rows pass through unconverted.
  const { rateFor, min: rateMin, max: rateMax, count: rateDays } =
    await getRateTable(payPeriodStart, payPeriodEnd);

  const bvdUsdByUnit = aggregateBVD(bvdUsdRows, rateFor);
  const bvdCadByUnit = aggregateBVD(bvdCadRows);
  const ezUsdByUnit  = aggregateEasyPass(ezUsdRows, rateFor);
  const ezCadByUnit  = aggregateEasyPass(ezCadRows);
  const bwUsdByTxp   = aggregateBlueWater(bwUsdRows, rateFor);
  const bwCadByTxp   = aggregateBlueWater(bwCadRows);

  // Merge two transponder entries (usd/cad totals + per-date breakdown) into a unit entry.
  const mergeInto = (target, src) => {
    target.usd += src.usd;
    target.cad += src.cad;
    for (const [dk, d] of src.byDate) {
      const cur = target.byDate.get(dk) ?? { usd: 0, cad: 0, rate: d.rate };
      cur.usd += d.usd; cur.cad += d.cad;
      target.byDate.set(dk, cur);
    }
    return target;
  };

  // A transponder rendered in scientific notation (e.g. "2.53E+13") has lost precision
  // during a spreadsheet CSV export — it can never match the real 14-digit number.
  const looksMangled = txp => /e\+\d/i.test(txp); // the "E+" exponent marks scientific notation; real IDs lack the '+'
  const txpWarning = (cur, txp) => looksMangled(txp)
    ? `BlueWater ${cur}: transponder "${txp}" looks truncated to scientific notation. Re-upload the .xlsx or export the transponder column as text. Rows skipped.`
    : `BlueWater ${cur}: no unit for transponder ${txp}`;

  const bwUsdByUnit = new Map(), bwCadByUnit = new Map();
  for (const [txp, t] of bwUsdByTxp) {
    const uid = transponderMap[txp];
    if (!uid) { warnings.push(txpWarning('USD', txp)); continue; }
    bwUsdByUnit.set(uid, mergeInto(bwUsdByUnit.get(uid) ?? { usd: 0, cad: 0, byDate: new Map() }, t));
  }
  for (const [txp, t] of bwCadByTxp) {
    const uid = transponderMap[txp];
    if (!uid) { warnings.push(txpWarning('CAD', txp)); continue; }
    bwCadByUnit.set(uid, mergeInto(bwCadByUnit.get(uid) ?? { usd: 0, cad: 0, byDate: new Map() }, t));
  }

  // Collect unit IDs present in any uploaded file
  const csvUnits = new Set([
    ...bvdUsdByUnit.keys(), ...bvdCadByUnit.keys(),
    ...ezUsdByUnit.keys(),  ...ezCadByUnit.keys(),
    ...bwUsdByUnit.keys(),  ...bwCadByUnit.keys(),
  ]);

  const bills = await getConsolidatedBills(payPeriodStart, payPeriodEnd);

  // Pre-filter: keep only bills whose driver appears in the uploaded files
  const csvBills = [];
  let skippedNoMap = 0, skippedNoCsv = 0;
  for (const bill of bills) {
    const displayName = normalizeName(bill.bill_to_company_name);
    let uid = nameToUnit.get(displayName);
    if (!uid) {
      for (const [u, info] of Object.entries(driverMap)) {
        if (info.id && info.id === bill.driver_id) { uid = u; break; }
      }
    }
    if (!uid)               { skippedNoMap++; continue; }
    if (!csvUnits.has(uid)) { skippedNoCsv++; continue; }
    csvBills.push({ bill, uid, displayName });
  }
  console.log(`[Process] ${bills.length} bills fetched → ${csvBills.length} matched CSV data, ${skippedNoCsv} skipped (no CSV data), ${skippedNoMap} skipped (no driver mapping)`);

  const jobItems = [];
  for (const { bill, uid, displayName } of csvBills) {

    // Fetch all sub-bills so we can populate bill_items and manifest fields in the PUT payload.
    // The consolidated bill GET returns empty bill_items for sub-bills; we need the real items
    // for manifest sub-bills (API rejects an empty array — it interprets it as "delete all").
    const MANIFEST_KEYS = [
      'manifest_id', 'manifest_full_id', 'manifest_dispatched_at', 'manifest_completed_at',
      'manifest_first_stop_org_name', 'manifest_first_stop_city',
      'manifest_last_stop_org_name',  'manifest_last_stop_city',
      'manifest_estimated_miles', 'manifest_estimated_duration', 'manifest_total_stops',
    ];
    for (const b of (bill.bills ?? [])) {
      const fetched = await getSubBill(b.id);
      if (!fetched) continue;
      b.bill_items = fetched.items ?? [];
      for (const k of MANIFEST_KEYS) {
        if (fetched[k] !== undefined) b[k] = fetched[k];
      }
    }

    const recurring = (bill.bills ?? []).find(b => b.type === 'driverPay-scheduler-recurringCosts');
    if (!recurring) continue;

    const existingItems = (recurring.bill_items ?? []).filter(i => i.quantity !== 0);
    const existingDescs = new Set(existingItems.map(i => i.description));

    const newItems = [], charges = [], alreadyPosted = [];

    // amounts: { usd, cad } (unrounded). For USD sources show usd→cad; for CAD sources
    // usd === cad, so pass showUsd=false to display the CAD amount alone.
    const addCharge = (typeId, desc, amounts, showUsd) => {
      if (existingDescs.has(desc)) { alreadyPosted.push({ type: desc }); return; }
      const amountCad = round2(amounts.cad);
      newItems.push(buildItem(typeId, desc, amountCad));
      if (!showUsd) { charges.push({ type: desc, amountCad }); return; }
      // Per-transaction-date breakdown: date · USD subtotal · rate · CAD subtotal.
      const breakdown = [...amounts.byDate.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([date, d]) => ({ date, amountUsd: round2(d.usd), rate: d.rate, amountCad: round2(d.cad) }));
      charges.push({ type: desc, amountUsd: round2(amounts.usd), amountCad, breakdown });
    };

    const bvdUsd = bvdUsdByUnit.get(uid);
    if (bvdUsd) addCharge(BILL_ITEM_TYPES.BVD_FUEL, DESCS.BVD_FUEL_USD, bvdUsd, true);

    const bvdCad = bvdCadByUnit.get(uid);
    if (bvdCad) addCharge(BILL_ITEM_TYPES.BVD_FUEL, DESCS.BVD_FUEL_CAD, bvdCad, false);

    const ezUsd = ezUsdByUnit.get(uid);
    if (ezUsd)  addCharge(BILL_ITEM_TYPES.TOLL, DESCS.EASYPASS_USD, ezUsd, true);

    const ezCad = ezCadByUnit.get(uid);
    if (ezCad)  addCharge(BILL_ITEM_TYPES.TOLL, DESCS.EASYPASS_CAD, ezCad, false);

    const bwUsd = bwUsdByUnit.get(uid);
    if (bwUsd)  addCharge(BILL_ITEM_TYPES.TOLL, DESCS.BLUEWATER_USD, bwUsd, true);

    const bwCad = bwCadByUnit.get(uid);
    if (bwCad)  addCharge(BILL_ITEM_TYPES.TOLL, DESCS.BLUEWATER_CAD, bwCad, false);

    if (charges.length === 0 && alreadyPosted.length === 0) continue;

    bill.bills?.forEach(b => {
      if (Array.isArray(b.bill_items)) {
        b.bill_items = b.bill_items.filter(i => i.quantity !== 0);
      }
    });
    recurring.bill_items = [...existingItems, ...newItems];
    const orgUrl = (process.env.ROSEROCKET_ORG_URL || '').replace(/\/+$/, '');
    jobItems.push({ billId: bill.id, billNumber: bill.full_id ?? bill.fullId ?? '', billUrl: `${orgUrl}/#/ops/accounting/payables/bills/${bill.id}`, billData: bill, driverDisplayName: toTitleCase(displayName), charges, alreadyPosted, hasNewCharges: newItems.length > 0 });
  }

  const jobId = uuidv4();
  jobs.set(jobId, { items: jobItems, createdAt: Date.now() });

  res.json({
    jobId,
    exchange: { min: rateMin, max: rateMax, days: rateDays, markup: 0.02 },
    payPeriodStart,
    payPeriodEnd,
    preview: jobItems.map(({ billId, billNumber, billUrl, driverDisplayName, charges, alreadyPosted, hasNewCharges }) => ({
      billId, billNumber, billUrl, driverDisplayName, charges, alreadyPosted, hasNewCharges,
    })),
    warnings,
  });
}));

// ─── Confirm ──────────────────────────────────────────────────────────────────

app.post('/api/confirm', wrap(async (req, res) => {
  const { jobId, ignoredBillIds = [] } = req.body;
  const job = jobs.get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found or expired, please re-process' });
  jobs.delete(jobId);

  const ignoredSet = new Set(ignoredBillIds);
  const results = [];
  for (const { billId, billData, driverDisplayName, charges, hasNewCharges } of job.items) {
    if (!hasNewCharges || ignoredSet.has(billId)) { results.push({ driverDisplayName, status: 'skipped' }); continue; }
    try {
      await updateConsolidatedBill(billId, billData, false);
      results.push({ driverDisplayName, status: 'updated', charges });
    } catch (e) {
      results.push({ driverDisplayName, status: 'error', message: e.message });
    }
  }
  res.json({ results });
}));

// ─── Manifest hours → Google Sheet ────────────────────────────────────────────

// Rebuild the sheet now. Body { dryRun: true } reports what it would write instead.
app.post('/api/hours/sheet/sync', wrap(async (req, res) => {
  const dryRun = req.body?.dryRun === true || req.query.dryRun === 'true';
  const days = Number(req.body?.days ?? req.query.days) || undefined;
  res.json(await syncHoursSheet({ dryRun, days }));
}));

// The schedule runs inside this process, so the server has to stay up for it to fire.
//
// HOURS_SYNC_CRON takes a plain number of minutes (60 for hourly), which is what this is
// normally set to. A five-field cron expression still works for anything that needs to
// land at a particular time of day, and `off` hands scheduling to something external.
const SHEET_SCHEDULE = (process.env.HOURS_SYNC_CRON || '60').trim();
const SHEET_TZ = process.env.HOURS_SYNC_TZ || process.env.FUEL_SYNC_TZ || 'America/Toronto';
const runSheetSync = () =>
  syncHoursSheet().catch(e => console.error('[HoursSheet] Scheduled run failed:', e.message));

// Runs are counted from startup, so without a sync on boot a restart would leave the sheet
// untouched for a whole interval. Off by way of HOURS_SYNC_ON_START=false, which matters
// under `npm run dev`: nodemon restarts on every file save, and each restart would
// otherwise kick off a full sweep.
const SYNC_ON_START = !/^(false|0|no|off)$/i.test((process.env.HOURS_SYNC_ON_START ?? 'true').trim());
let sheetScheduleActive = false;

if (!process.env.HOURS_SHEET_ID) {
  console.warn('[HoursSheet] HOURS_SHEET_ID is not set, sheet sync disabled');
} else if (/^(off|false|none|disabled)$/i.test(SHEET_SCHEDULE)) {
  console.log('[HoursSheet] In-process schedule off; expecting an external scheduler');
} else if (/^\d+$/.test(SHEET_SCHEDULE)) {
  const minutes = Number(SHEET_SCHEDULE);
  if (minutes < 1) {
    console.warn(`[HoursSheet] HOURS_SYNC_CRON must be at least 1 minute, got '${SHEET_SCHEDULE}', sheet sync disabled`);
  } else {
    // A run sweeps every manifest for the mapped drivers and takes around half a minute,
    // so anything very frequent is mostly load for no benefit.
    if (minutes < 15) console.warn(`[HoursSheet] Syncing every ${minutes} min is frequent; a run takes about 30s`);
    setInterval(runSheetSync, minutes * 60_000);
    sheetScheduleActive = true;
    console.log(`[HoursSheet] Scheduled every ${minutes} minute${minutes === 1 ? '' : 's'}`);
  }
} else if (cron.validate(SHEET_SCHEDULE)) {
  cron.schedule(SHEET_SCHEDULE, runSheetSync, { timezone: SHEET_TZ });
  sheetScheduleActive = true;
  console.log(`[HoursSheet] Scheduled '${SHEET_SCHEDULE}' (${SHEET_TZ})`);
} else {
  console.warn(`[HoursSheet] HOURS_SYNC_CRON '${SHEET_SCHEDULE}' is neither a number of minutes nor a cron expression, sheet sync disabled`);
}

// ─── Fuel Surcharge ─────────────────────────────────────────────────────────────

// Preview: fetch the latest Speedy rates and report intended actions per org (no writes).
app.get('/api/fuel-surcharge/preview', wrap(async (req, res) => {
  res.json(await runFuelSurchargeSync({ dryRun: true }));
}));

// Run now: apply the latest rates to every org. Pass { dryRun: true } to preview instead.
app.post('/api/fuel-surcharge/run', wrap(async (req, res) => {
  const dryRun  = req.body?.dryRun === true || req.query.dryRun === 'true';
  const onlyOrg = req.body?.onlyOrg || req.query.onlyOrg || null;
  res.json(await runFuelSurchargeSync({ dryRun, onlyOrg }));
}));

// Scheduled sync — every morning (07:00 America/Toronto by default). Daily rather than
// weekly because the sources do not publish on a fixed day: a weekly run gets one attempt
// at each week's rate, and misses it entirely when a source posts late.
const FUEL_CRON = process.env.FUEL_SYNC_CRON || '0 7 * * *';
const FUEL_TZ   = process.env.FUEL_SYNC_TZ   || 'America/Toronto';
if (cron.validate(FUEL_CRON)) {
  cron.schedule(FUEL_CRON, () => {
    console.log('[FuelSurcharge] Scheduled run starting');
    runFuelSurchargeSync().catch(e => console.error('[FuelSurcharge] Scheduled run failed:', e.message));
  }, { timezone: FUEL_TZ });
  console.log(`[FuelSurcharge] Scheduled '${FUEL_CRON}' (${FUEL_TZ})`);
} else {
  console.warn(`[FuelSurcharge] Invalid FUEL_SYNC_CRON '${FUEL_CRON}', scheduler disabled`);
}


// ─── Manifest Hours (Motive → RoseRocket) ─────────────────────────────────────

// Which RoseRocket drivers are linked to which Motive driver, and which still need
// linking by hand. Names that differ between the two systems (nicknames, typos) never
// match automatically, so they are linked once here and remembered.
app.get('/api/hours/drivers', wrap(async (req, res) => {
  const pairing = await buildPairing();
  res.json({
    counts: pairing.counts,
    drivers: pairing.pairs.map(p => ({
      rrUserId: p.rr.id, rrName: p.rr.name, vehicle: p.rr.vehicle,
      motiveId: p.motive?.id ?? null, motiveName: p.motive?.name ?? null,
      source: p.source, enabled: p.enabled !== false,
    })),
    unusedMotive: pairing.unusedMotive.map(m => ({ id: m.id, name: m.name, companyId: m.companyId })),
  });
}));

// Accepts either half on its own: the Motive link, whether the driver is switched on, or
// both at once.
app.put('/api/hours/drivers/:rrUserId', wrap(async (req, res) => {
  const { motiveId, enabled } = req.body ?? {};
  if (motiveId === undefined && enabled === undefined) {
    return res.status(400).json({ error: 'Provide motiveId, enabled, or both' });
  }
  if (motiveId !== undefined && motiveId !== null && !Number.isInteger(motiveId)) {
    return res.status(400).json({ error: 'motiveId must be an integer, or null to unlink' });
  }
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be true or false' });
  }
  if (enabled !== undefined) await setEnabled(req.params.rrUserId, enabled);
  if (motiveId !== undefined) await setLink(req.params.rrUserId, motiveId);
  res.json({ ok: true });
}));

// Preview: work out the hours for every manifest in the window. Writes nothing.
app.post('/api/hours/preview', wrap(async (req, res) => {
  const { startDate, endDate, endRounding = 'nearest', onlyRrUserIds = null } = req.body ?? {};
  if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate are required' });
  if (endDate < startDate)     return res.status(400).json({ error: 'endDate must not be before startDate' });

  const preview = await buildPreview({ startDate, endDate, endRounding, onlyRrUserIds });
  const jobId = uuidv4();
  hoursJobs.set(jobId, { rows: preview.rows, createdAt: Date.now() });

  const counts = preview.rows.reduce((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc; }, {});
  console.log(`[Hours] ${startDate}→${endDate}: ${preview.rows.length} rows`, counts);
  res.json({ jobId, startDate, endDate, counts, ...preview });
}));

// A hand-typed duration replaces the computed one for that manifest. The bounds are
// checked here as well as in the browser, because this endpoint writes to driver pay and
// works from server-side state a caller could reach without going through the UI.
const MAX_DURATION_SECONDS = 24 * 3600;
function readOverride(value) {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || value <= 0 || value > MAX_DURATION_SECONDS) {
    return { error: 'Edited duration must be a whole number of seconds between 1 and 24 hours' };
  }
  return { seconds: value };
}

// Apply: write the approved rows back to RoseRocket.
app.post('/api/hours/apply', wrap(async (req, res) => {
  const { jobId, approvedManifestIds = [], overrides = {}, dryRun = false } = req.body ?? {};
  const job = hoursJobs.get(jobId);
  if (!job) return res.status(404).json({ error: 'Preview expired, please run it again' });

  const approved = new Set(approvedManifestIds);
  const results = [];
  for (const row of job.rows) {
    if (row.status !== 'propose' || !approved.has(row.manifestId)) continue;

    const base = { manifestId: row.manifestId, fullId: row.fullId, url: row.url,
                   driverName: row.driverName, date: row.date };
    const override = readOverride(overrides[row.manifestId]);
    if (override?.error) { results.push({ ...base, status: 'error', message: override.error }); continue; }

    const seconds = override ? override.seconds : row.computed.seconds;
    const edited = seconds !== row.computed.seconds;

    try {
      const out = await updateManifestDuration(row.manifestId, seconds, { dryRun });
      results.push({ ...out, ...base, status: 'updated', edited,
                     formatted: formatDuration(seconds),
                     computedFormatted: row.computed.formatted });
    } catch (e) {
      results.push({ ...base, status: 'error', message: e.message });
    }
  }
  if (!dryRun) hoursJobs.delete(jobId);
  console.log(`[Hours] applied ${results.filter(r => r.status === 'updated').length}/${results.length}${dryRun ? ' (dry run)' : ''}`);
  res.json({ results, dryRun });
}));

// ─── SPA fallback ─────────────────────────────────────────────────────────────

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'client/dist/index.html')));

// ─── Error handler ────────────────────────────────────────────────────────────

app.use((err, req, res, _next) => {
  console.error('[API]', err.message);
  res.status(err.status || 500).json({ error: err.message });
});

// ─── Start ────────────────────────────────────────────────────────────────────

async function start() {
  await initDb();
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`[Server] http://localhost:${PORT}`);
    if (sheetScheduleActive && SYNC_ON_START) {
      console.log('[HoursSheet] Running once now, then on the schedule above');
      runSheetSync();
    }
  });
}

start().catch(err => {
  console.error('[Fatal]', err.message);
  const hint = describeDbError(err);
  if (hint) console.error(`\n${hint}\n`);
  process.exit(1);
});
