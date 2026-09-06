require('dotenv').config();
const fs = require('fs');
const { google } = require('googleapis');

// drive.file covers only files this service account itself created, which is what the
// self-test spreadsheet needs. Reaching the client's own sheet relies on that sheet being
// shared with the service account, not on a broad Drive scope.
const DEFAULT_COLUMN_WIDTH = 130;   // pixels, seeded only on a newly created tab

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];

// Two ways to supply the service-account key, matching how the rr_sheet_sync project does
// it: the JSON inline for hosted environments, or a path to the file for local runs.
function loadCredentials() {
  const inline = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const file = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;

  const fix = c => (c?.private_key?.includes('\\n')
    ? { ...c, private_key: c.private_key.replace(/\\n/g, '\n') } : c);

  if (inline) {
    try { return fix(JSON.parse(inline)); }
    catch (e) { throw new Error(`GOOGLE_SERVICE_ACCOUNT_JSON is set but is not valid JSON: ${e.message}`); }
  }
  if (file) {
    if (!fs.existsSync(file)) throw new Error(`Service account key file not found: ${file}`);
    return fix(JSON.parse(fs.readFileSync(file, 'utf8')));
  }
  throw new Error('No Google credentials. Set GOOGLE_SERVICE_ACCOUNT_KEY_FILE or GOOGLE_SERVICE_ACCOUNT_JSON');
}

let client = null;
async function getSheets() {
  if (client) return client;
  const credentials = loadCredentials();
  const auth = new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
  client = google.sheets({ version: 'v4', auth: await auth.getClient() });
  return client;
}

function serviceAccountEmail() {
  try { return loadCredentials().client_email ?? null; } catch { return null; }
}

async function getSpreadsheet(spreadsheetId) {
  const sheets = await getSheets();
  const { data } = await sheets.spreadsheets.get({ spreadsheetId, fields: 'properties.title,sheets.properties' });
  return data;
}

// Create the tab if it is not there yet. Reports whether it had to be created, because
// the layout is only ever seeded on a brand-new tab.
async function ensureTab(spreadsheetId, title) {
  const sheets = await getSheets();
  const meta = await getSpreadsheet(spreadsheetId);
  const found = meta.sheets?.find(s => s.properties?.title === title);
  if (found) return { sheetId: found.properties.sheetId, created: false };

  const { data } = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] },
  });
  return { sheetId: data.replies?.[0]?.addSheet?.properties?.sheetId ?? null, created: true };
}

function colLetter(index) {
  let n = index, out = '';
  do { out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return out;
}

// Replace the tab's contents with a header row and the given rows.
//
// The old values are cleared first so a shrinking window does not leave stale rows behind,
// and the header is frozen and bolded so the sheet stays readable once it fills up.
//
// `hyperlink` turns one column into clickable labels: { index, urls } where urls lines up
// with rows. It is written in a second pass because the body goes in as RAW, which keeps
// text like "+0h 15m" intact instead of Sheets reading the leading sign as a formula.
async function replaceTab(spreadsheetId, title, header, rows, { hyperlink = null } = {}) {
  const sheets = await getSheets();
  const { sheetId, created } = await ensureTab(spreadsheetId, title);

  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `'${title}'!A:ZZ` });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${title}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [header, ...rows] },
  });

  if (hyperlink && rows.length) {
    const esc = v => String(v ?? '').replace(/"/g, '""');
    const values = rows.map((row, i) => {
      const label = row[hyperlink.index];
      const url = hyperlink.urls?.[i];
      return [url && label ? `=HYPERLINK("${esc(url)}","${esc(label)}")` : (label ?? '')];
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${title}'!${colLetter(hyperlink.index)}2`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });
  }

  // Layout is seeded once, when the tab is first created. After that the widths, the
  // frozen row and the header styling belong to whoever is using the sheet: a column
  // resized by hand has to survive every later sync, so nothing here touches them again.
  if (created && sheetId !== null) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          { updateSheetProperties: {
              properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
              fields: 'gridProperties.frozenRowCount' } },
          { repeatCell: {
              range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
              cell: { userEnteredFormat: { textFormat: { bold: true } } },
              fields: 'userEnteredFormat.textFormat.bold' } },
          { updateDimensionProperties: {
              range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: header.length },
              properties: { pixelSize: DEFAULT_COLUMN_WIDTH },
              fields: 'pixelSize' } },
        ],
      },
    });
  }
  return { rows: rows.length, tab: title, created };
}

module.exports = { getSheets, getSpreadsheet, ensureTab, replaceTab, colLetter, serviceAccountEmail };
