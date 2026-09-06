require('dotenv').config();
const { buildPreview } = require('./hoursSync');
const { formatDuration } = require('./hours');
const { replaceTab } = require('./sheets');

const TAB       = process.env.HOURS_SHEET_TAB || 'Manifest Hours';
const DAYS      = Number(process.env.HOURS_SYNC_DAYS || 14);
const SHEET_ID  = process.env.HOURS_SHEET_ID;
const TZ        = process.env.FUEL_SYNC_TZ || 'America/Toronto';

const HEADER = [
  'Date', 'Driver', 'Manifest',
  'Motive time', 'RR time', 'Difference', 'Difference (mins)', 'RR vs Motive',
  'Set by hand', 'Went on duty', 'Last off duty', 'Counted from', 'Counted to',
  'On time', 'Shipping doc', 'Doc agrees', 'Last checked', 'Note',
];

// The manifest number itself is the link, so there is no separate URL column.
const MANIFEST_COLUMN = HEADER.indexOf('Manifest');

// Today where the drivers are, not where the server happens to be.
function todayLocal(tz = TZ) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());
}

function rollingWindow(days = DAYS, today = todayLocal()) {
  const end = today;
  const start = new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * 86_400_000)
    .toISOString().slice(0, 10);
  return { startDate: start, endDate: end };
}

// The point of the sheet is to show how often the time entered in RoseRocket departs from
// what Motive says, and by how much. Positive means RoseRocket is the higher of the two.
function difference(rrSeconds, motiveSeconds) {
  if (rrSeconds == null || motiveSeconds == null) return { text: '', minutes: '', direction: '' };
  const delta = rrSeconds - motiveSeconds;
  if (delta === 0) return { text: 'same', minutes: 0, direction: 'same' };
  return {
    text: `${delta > 0 ? '+' : '-'}${formatDuration(Math.abs(delta))}`,
    minutes: Math.round(delta / 60),
    direction: delta > 0 ? 'higher' : 'lower',
  };
}

function toRow(r, checkedAt) {
  const motive = r.computed?.seconds ?? null;
  const rr = r.current?.seconds ?? null;
  const d = difference(rr, motive);
  const w = r.computed?.working ?? {};
  return [
    r.date, r.driverName, r.fullId ?? '',
    motive == null ? '' : formatDuration(motive),
    rr == null ? '' : formatDuration(rr),
    d.text, d.minutes, d.direction,
    r.current?.setByHand ? 'yes' : 'no',
    w.firstOnDuty ?? '', w.lastOffDuty ?? '', w.startUsed ?? '', w.endUsed ?? '',
    r.computed ? (r.computed.onTime ? 'yes' : 'no') : '',
    r.docs?.motive ?? '',
    r.docs?.agrees === true ? 'yes' : r.docs?.agrees === false ? 'NO' : '',
    checkedAt, r.reason ?? '',
  ];
}

// Rebuild the sheet from what RoseRocket and Motive currently say.
//
// Reading RoseRocket fresh every run is the point: a manifest a dispatcher corrected by
// hand shows their figure, exactly like one the tool wrote, so the sheet reflects reality
// rather than only what this app did.
async function syncHoursSheet({ days = DAYS, spreadsheetId = SHEET_ID, tab = TAB, dryRun = false } = {}) {
  if (!spreadsheetId) throw new Error('Missing HOURS_SHEET_ID');

  const { startDate, endDate } = rollingWindow(days);
  const preview = await buildPreview({ startDate, endDate });

  // Only real manifests belong in the sheet. buildPreview also reports days a driver has a
  // Motive log but no manifest, which is useful in the tool and meaningless as a row here.
  const rows = preview.rows.filter(r => r.manifestId);

  const checkedAt = new Date().toISOString().replace('T', ' ').slice(0, 16);
  // Sort once, then derive both the cell values and the manifest links from that same
  // order, so the hyperlinks cannot drift out of line with the rows they belong to.
  const sorted = [...rows].sort((a, b) =>
    (a.date === b.date ? a.driverName.localeCompare(b.driverName) : a.date.localeCompare(b.date)));
  const values = sorted.map(r => toRow(r, checkedAt));
  const urls = sorted.map(r => r.url ?? null);

  const differing = values.filter(v => v[7] === 'higher' || v[7] === 'lower').length;
  const summary = {
    ranAt: new Date().toISOString(), dryRun, startDate, endDate, days,
    manifests: values.length,
    differFromMotive: differing,
    drivers: preview.pairing,
    tab, spreadsheetId,
  };

  let written = null;
  if (!dryRun) {
    written = await replaceTab(spreadsheetId, tab, HEADER, values, {
      hyperlink: { index: MANIFEST_COLUMN, urls },
    });
  }
  // A newly created tab is the only time this sets column widths or freezes the header.
  // On an existing tab the layout is the client's and is left alone.
  summary.tabCreated = written ? written.created : null;

  console.log(`[HoursSheet] ${dryRun ? 'DRY-RUN' : 'SYNC'} ${startDate}→${endDate}: ` +
              `${values.length} manifests, ${differing} differ from Motive`);
  return summary;
}

module.exports = { syncHoursSheet, rollingWindow, difference, HEADER, toRow };
