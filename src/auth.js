require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const DEFAULT_ORG_URL = process.env.ROSEROCKET_ORG_URL;
const USERNAME        = process.env.ROSEROCKET_USERNAME;
const PASSWORD        = process.env.ROSEROCKET_PASSWORD;
const CLIENT_ID       = process.env.ROSEROCKET_CLIENT_ID;
const CLIENT_SECRET   = process.env.ROSEROCKET_CLIENT_SECRET;

const stores = new Map();

function orgSlug(orgUrl) {
  try { return new URL(orgUrl).hostname.split('.')[0] || 'default'; }
  catch { return 'default'; }
}

function tokenPath(orgUrl) {
  const slug = orgSlug(orgUrl);
  return orgUrl === DEFAULT_ORG_URL
    ? path.join(__dirname, '..', '.token.json')
    : path.join(__dirname, '..', `.token.${slug}.json`);
}

function getStore(orgUrl) {
  const key = orgSlug(orgUrl);
  if (!stores.has(key)) stores.set(key, { memory: { token: null, expiresAt: 0 }, inFlight: null });
  return stores.get(key);
}

function valid(entry) {
  return entry && entry.token && Date.now() < entry.expiresAt - 60_000;
}

// A cached token belongs to whoever logged in to get it. If the credentials in .env have
// since been pointed at a different account, the cache has to be ignored, or the app keeps
// acting as the previous user until the old token happens to expire. That matters because
// RoseRocket stamps the activity feed with the account behind the token.
function belongsToCurrentUser(entry) {
  return entry?.user === USERNAME;
}

function loadDiskToken(orgUrl) {
  try {
    const entry = JSON.parse(fs.readFileSync(tokenPath(orgUrl), 'utf8'));
    return valid(entry) && belongsToCurrentUser(entry) ? entry : null;
  } catch { return null; }
}

function saveDiskToken(entry, orgUrl) {
  try { fs.writeFileSync(tokenPath(orgUrl), JSON.stringify(entry), 'utf8'); }
  catch { /* non-fatal */ }
}

async function login(orgUrl) {
  if (!orgUrl || !USERNAME || !PASSWORD || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error(
      'Missing auth env vars. Required: ROSEROCKET_ORG_URL, ROSEROCKET_USERNAME, ' +
      'ROSEROCKET_PASSWORD, ROSEROCKET_CLIENT_ID, ROSEROCKET_CLIENT_SECRET'
    );
  }
  const url = `${String(orgUrl).replace(/\/+$/, '')}/api/v1/sessions`;
  const res = await axios.post(url, {
    email: USERNAME, password: PASSWORD,
    client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
  });
  const payload = res.data?.data ?? res.data;
  const access_token = payload?.access_token;
  const expires_in   = payload?.expires_in ?? 86400;
  if (!access_token) throw new Error(`No access_token in response: ${JSON.stringify(res.data)}`);
  const entry = { token: access_token, expiresAt: Date.now() + expires_in * 1000, user: USERNAME };
  saveDiskToken(entry, orgUrl);
  console.log(`[Auth] Token obtained for ${orgSlug(orgUrl)} as ${USERNAME}.`);
  return entry;
}

async function getToken(orgUrl = DEFAULT_ORG_URL) {
  if (!orgUrl) throw new Error('Missing ROSEROCKET_ORG_URL');
  const store = getStore(orgUrl);
  if (valid(store.memory) && belongsToCurrentUser(store.memory)) return store.memory.token;
  const disk = loadDiskToken(orgUrl);
  if (disk) { store.memory = disk; return disk.token; }
  if (!store.inFlight) {
    store.inFlight = login(orgUrl)
      .then(entry => { store.memory = entry; store.inFlight = null; return entry; })
      .catch(err  => { store.inFlight = null; throw err; });
  }
  const entry = await store.inFlight;
  return entry.token;
}

module.exports = { getToken };
