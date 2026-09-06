// CSV rather than a binary spreadsheet: Excel and Google Sheets both open it directly,
// and it keeps the export as a plain function of what is on screen with nothing to
// install. The leading BOM is what makes Excel read it as UTF-8.
function toCsv(rows) {
  const cell = v => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map(r => r.map(cell).join(',')).join('\r\n');
}

export function download(filename, rows) {
  const blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const fmt = seconds => seconds == null ? ''
  : `${Math.floor(seconds / 3600)}h ${String(Math.round((seconds % 3600) / 60)).padStart(2, '0')}m`;

const STATUS_LABEL = {
  propose: 'To update',
  already_edited: 'Already set by hand',
  unchanged: 'Already correct',
  flag: 'Needs a look',
};

export const PREVIEW_HEADER = [
  'Date', 'Driver', 'Manifest', 'Status',
  'On the manifest', 'Motive gives', 'Will be written', 'Difference',
  'Scheduled start', 'Went on duty', 'Last off duty', 'Counted from', 'Counted to',
  'On time', 'Minutes late', 'Motive driver', 'Shipping doc', 'Doc agrees',
  'Note',
];

// The manifest number carries its own link, so there is no separate URL column. Excel and
// Sheets only turn this into a clickable cell when they evaluate formulas on opening the
// file, which is their default.
const link = (url, label) => {
  if (!url || !label) return label ?? '';
  const esc = v => String(v).replace(/"/g, '""');
  return `=HYPERLINK("${esc(url)}","${esc(label)}")`;
};

// Because that evaluation is on, any other cell starting with = + - or @ would also be read
// as a formula. The difference is the only one at risk, so it says "more" and "less"
// rather than leading with a sign.
const differenceText = (seconds) => {
  if (seconds == null) return '';
  if (seconds === 0) return 'same';
  return `${fmt(Math.abs(seconds))} ${seconds > 0 ? 'more' : 'less'}`;
};

// One row per line on screen, in the same order, carrying whatever the operator has
// since typed or rejected so the file matches what they are looking at.
export function previewRows(data, { overrides = {}, rejected = new Set() } = {}) {
  return (data.rows ?? []).map(r => {
    const override = overrides[r.manifestId];
    const willWrite = r.status === 'propose' && !rejected.has(r.manifestId)
      ? (override ?? r.computed?.seconds) : null;
    const status = r.status === 'propose' && rejected.has(r.manifestId)
      ? 'Rejected' : (STATUS_LABEL[r.status] ?? r.status);
    const w = r.computed?.working ?? {};
    const diff = willWrite != null && r.current ? willWrite - r.current.seconds : null;

    return [
      r.date, r.driverName, link(r.url, r.fullId), status,
      fmt(r.current?.seconds), fmt(r.computed?.seconds), fmt(willWrite),
      differenceText(diff),
      w.scheduled ?? '', w.firstOnDuty ?? '', w.lastOffDuty ?? '', w.startUsed ?? '', w.endUsed ?? '',
      r.computed ? (r.computed.onTime ? 'yes' : 'no') : '',
      r.computed && !r.computed.onTime ? r.computed.lateByMin : '',
      r.motiveDriver ?? '', r.docs?.motive ?? '',
      r.docs?.agrees === true ? 'yes' : r.docs?.agrees === false ? 'NO' : '',
      r.reason ?? '',
    ];
  });
}

export const RESULT_HEADER = [
  'Date', 'Driver', 'Manifest', 'Outcome', 'Was', 'Written', 'Calculated', 'Edited by hand', 'Message',
];

export function resultRows(results) {
  return (results ?? []).map(r => [
    r.date, r.driverName, link(r.url, r.fullId),
    r.status === 'updated' ? 'Updated' : 'Error',
    fmt(r.from), r.formatted ?? '', r.computedFormatted ?? '',
    r.edited ? 'yes' : '', r.message ?? '',
  ]);
}
