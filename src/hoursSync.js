require('dotenv').config();
const motive = require('./motive');
const { computeHours, formatDuration, localDate } = require('./hours');
const { listManifests, manifestsInWindow } = require('./manifests');
const { buildPairing } = require('./driverMap');

const ORG_URL = (process.env.ROSEROCKET_ORG_URL || '').replace(/\/+$/, '');

// Drivers type the manifest number into Motive's shipping-docs box by hand, so it arrives
// as anything from "CETM28022" to "M27991" to "Various". Comparing digits only turns the
// tidy majority into a usable confirmation and leaves the rest as simply unknown.
function docsAgree(shippingDocs, fullId) {
  const a = String(shippingDocs ?? '').replace(/\D/g, '');
  const b = String(fullId ?? '').replace(/\D/g, '');
  if (!a || !b || a.length < 4) return null;      // nothing usable typed in
  return a === b;
}

const STATUS = {
  PROPOSE:  'propose',        // ready to write
  UNCHANGED:'unchanged',      // already carries exactly this value
  EDITED:   'already_edited', // a human set it; leave it alone
  FLAG:     'flag',           // needs a person to look
};

// Build the full picture for a date window without writing anything.
async function buildPreview({ startDate, endDate, endRounding = 'nearest', onlyRrUserIds = null, pairing: given = null }) {
  const pairing = given ?? await buildPairing();
  // Drivers switched off in Driver Links are left out entirely, along with any that are
  // not linked to Motive.
  let linked = pairing.pairs.filter(p => p.motive && p.enabled !== false);
  if (onlyRrUserIds?.length) {
    const want = new Set(onlyRrUserIds);
    linked = linked.filter(p => want.has(p.rr.id));
  }
  if (!linked.length) return { rows: [], warnings: ['No drivers are switched on and linked to Motive yet.'], pairing: pairing.counts };

  const rrIds = linked.map(p => p.rr.id);
  const motiveIds = linked.map(p => p.motive.id);
  const byRrId = new Map(linked.map(p => [p.rr.id, p]));

  const [allManifests, logs] = await Promise.all([
    listManifests(rrIds),
    motive.getLogs(motiveIds, startDate, endDate),
  ]);

  const manifests = manifestsInWindow(allManifests, startDate, endDate)
    .filter(m => byRrId.has(m.driver_user_id));

  // One manifest per driver per date is the stated rule; anything else is flagged.
  const manifestsByKey = new Map();
  for (const m of manifests) {
    const key = `${m.driver_user_id}|${m.start_at.slice(0, 10)}`;
    if (!manifestsByKey.has(key)) manifestsByKey.set(key, []);
    manifestsByKey.get(key).push(m);
  }
  const logsByKey = new Map(logs.map(l => [`${l.driverId}|${l.date}`, l]));

  const rows = [];

  for (const [key, group] of manifestsByKey) {
    const [rrUserId, date] = key.split('|');
    const pair = byRrId.get(rrUserId);
    const driverName = pair.rr.name;
    const base = { driverName, date, motiveDriver: pair.motive.name };

    if (group.length > 1) {
      rows.push({ ...base, status: STATUS.FLAG, manifestId: group[0].id,
        fullId: group.map(m => m.full_id).join(', '),
        reason: `${group.length} manifests on this date. The rule assumes one per driver per day.` });
      continue;
    }

    const m = group[0];
    const row = {
      ...base,
      manifestId: m.id,
      fullId: m.full_id,
      url: `${ORG_URL}/#/ops/manifests/${m.id}`,
      scheduledStart: m.start_at,
      current: {
        seconds: m.estimated_duration ?? 0,
        formatted: formatDuration(m.estimated_duration ?? 0),
        setByHand: m.is_custom_estimated === true,
      },
      miles: m.estimated_miles,
    };

    if (m.derived_status !== 'completed') {
      rows.push({ ...row, status: STATUS.FLAG, reason: `manifest is ${m.derived_status}, not completed` });
      continue;
    }

    // The rule takes one day's hours from one day's log, so it only holds for a manifest
    // that starts and finishes on the same day. Long-haul runs cover up to a week and
    // several thousand miles; compressing one of those into a single day's hours would
    // wipe out most of the driver's time, so they are flagged instead of guessed at.
    const finishedOn = localDate(m.completed_at);
    if (finishedOn && finishedOn !== date) {
      const spanDays = Math.round((Date.parse(`${finishedOn}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
      rows.push({ ...row, status: STATUS.FLAG,
        reason: spanDays === 1
          ? 'manifest finished the next day, so it needs an end time by hand'
          : `manifest runs over ${spanDays + 1} days (finished ${finishedOn}), so the one-day rule does not apply` });
      continue;
    }

    const log = logsByKey.get(`${pair.motive.id}|${date}`);
    if (!log) {
      rows.push({ ...row, status: STATUS.FLAG, reason: 'no Motive log for this driver on this date' });
      continue;
    }

    const result = computeHours({ scheduledStartLocal: m.start_at, events: log.events, timeZone: log.timeZone || undefined, endRounding });
    row.docs = { motive: log.shippingDocs, agrees: docsAgree(log.shippingDocs, m.full_id) };

    if (result.skip) {
      rows.push({ ...row, status: STATUS.FLAG, reason: result.skip });
      continue;
    }

    row.computed = result;
    if (row.current.setByHand) {
      rows.push({ ...row, status: STATUS.EDITED, reason: 'already set by hand' });
    } else if (result.seconds === row.current.seconds) {
      rows.push({ ...row, status: STATUS.UNCHANGED, reason: 'already correct' });
    } else {
      rows.push({ ...row, status: STATUS.PROPOSE });
    }
  }

  // A day the driver worked that has no manifest at all is worth surfacing too.
  for (const log of logs) {
    const pair = linked.find(p => p.motive.id === log.driverId);
    if (!pair) continue;
    if (manifestsByKey.has(`${pair.rr.id}|${log.date}`)) continue;
    const worked = (log.events ?? []).some(e => e.type !== 'off_duty' && e.type !== 'sleeper');
    if (!worked) continue;
    rows.push({
      driverName: pair.rr.name, motiveDriver: pair.motive.name, date: log.date,
      status: STATUS.FLAG, reason: 'driver has a Motive log but no manifest on this date',
      docs: { motive: log.shippingDocs, agrees: null },
    });
  }

  rows.sort((a, b) => (a.date === b.date ? a.driverName.localeCompare(b.driverName) : a.date.localeCompare(b.date)));

  const warnings = [];
  if (pairing.counts.unmatched) {
    warnings.push(`${pairing.counts.unmatched} active RoseRocket driver(s) are not linked to Motive yet, so their manifests are not included. Link them on the Driver Links tab.`);
  }
  const mismatched = rows.filter(r => r.docs?.agrees === false).length;
  if (mismatched) {
    warnings.push(`${mismatched} manifest(s) do not agree with the shipping-doc number typed into Motive. Worth a look before approving.`);
  }

  return { rows, warnings, pairing: pairing.counts, endRounding };
}

module.exports = { buildPreview, docsAgree, STATUS };
