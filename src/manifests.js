require('dotenv').config();
const axios = require('axios');
const { getToken } = require('./auth');

const BASE_URL = (process.env.ROSEROCKET_ORG_URL || '').replace(/\/+$/, '');
const PAGE = 1000;          // the listing accepts far more than the usual 200
const CONCURRENCY = 5;
const CACHE_MS = 10 * 60 * 1000;

let cache = null;           // { key, at, rows }

async function headers() {
  return {
    Authorization: `Bearer ${await getToken()}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'x-requested-with': 'XMLHttpRequest',
  };
}

// A "manifest" in the UI is a master_trip in the API.
//
// The listing endpoint ignores every date filter and sort parameter we tried, so the
// only way to reach a given week is to pull the driver's whole history and filter here.
// Pages are fetched concurrently and the result is cached briefly, because a full sweep
// of the active fleet is ~8,600 records.
async function listManifests(driverUserIds) {
  const key = driverUserIds.slice().sort().join(',');
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.rows;

  const h = await headers();
  const params = { in_driver_user_ids: driverUserIds.join(','), limit: PAGE };
  const rows = [];
  let page = 0, done = false;

  while (!done) {
    const batch = Array.from({ length: CONCURRENCY }, (_, i) => page + i);
    page += CONCURRENCY;
    const results = await Promise.all(batch.map(async p => {
      const res = await axios.get(`${BASE_URL}/api/v1/master_trips`,
        { headers: h, params: { ...params, offset: p * PAGE }, timeout: 120_000 });
      return res.data?.data ?? [];
    }));
    for (const r of results) {
      rows.push(...r);
      if (r.length < PAGE) done = true;
    }
  }

  cache = { key, at: Date.now(), rows };
  return rows;
}

function invalidateCache() { cache = null; }

// Manifests whose scheduled start falls inside the window. Status is deliberately left
// alone here so the caller can report a manifest that exists but isn't completed yet,
// rather than it silently vanishing.
function manifestsInWindow(rows, startDate, endDate) {
  return rows.filter(m =>
    typeof m.start_at === 'string' &&
    m.start_at.slice(0, 10) >= startDate &&
    m.start_at.slice(0, 10) <= endDate);
}

async function getManifest(id) {
  const res = await axios.get(`${BASE_URL}/api/v1/master_trips/${id}`, { headers: await headers() });
  return res.data?.data?.master_trip ?? null;
}

// Write a new duration onto a manifest.
//
// This is the call the RoseRocket web app makes when a dispatcher edits the duration box
// on a manifest. The plain PUT /master_trips/{id} accepts estimated_duration and then
// silently discards it, so only this sub-route actually saves.
//
// estimated_miles has to be sent along, and is passed back exactly as stored so the
// manifest's distance is left alone. Motive measures every kilometre the truck moved that
// day, which is not the distance of this manifest, so we never write miles of our own.
//
// RoseRocket sets is_custom_estimated itself when this endpoint is used, which is what
// marks the value as deliberate and stops a later run from overwriting it.
async function updateManifestDuration(manifestId, seconds, { dryRun = true } = {}) {
  const current = await getManifest(manifestId);
  if (!current) throw new Error(`Manifest ${manifestId} not found`);

  const body = {
    estimated_duration: seconds,
    estimated_miles: current.estimated_miles,
  };

  if (dryRun) {
    return { dryRun: true, manifestId, fullId: current.full_id,
             from: current.estimated_duration, to: seconds, milesUnchanged: current.estimated_miles };
  }

  try {
    await axios.put(`${BASE_URL}/api/v1/master_trips/${manifestId}/estimated_travel`, body,
      { headers: await headers() });
    invalidateCache();
  } catch (err) {
    const status = err.response?.status;
    const detail = JSON.stringify(err.response?.data ?? {}).slice(0, 300);
    throw new Error(`PUT master_trips/${manifestId}/estimated_travel failed (${status}): ${detail}`);
  }

  // Read the value back rather than trusting the status code. An earlier version of this
  // wrote to an endpoint that answered 200 and saved nothing, and reported success for
  // every manifest it touched. Never tell the operator a manifest changed without looking.
  const after = await getManifest(manifestId);
  if (after?.estimated_duration !== seconds) {
    throw new Error(
      `RoseRocket accepted the request but did not save the duration: ${current.full_id} ` +
      `still reads ${after?.estimated_duration ?? 'unknown'}s, expected ${seconds}s.`);
  }

  return { dryRun: false, manifestId, fullId: current.full_id,
           from: current.estimated_duration, to: seconds,
           confirmed: after.estimated_duration, milesAfter: after.estimated_miles };
}

module.exports = { listManifests, manifestsInWindow, getManifest, updateManifestDuration, invalidateCache, BASE_URL, headers };
