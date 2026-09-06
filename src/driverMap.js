require('dotenv').config();
const axios = require('axios');
const { pool } = require('../db');
const motive = require('./motive');
const { BASE_URL, headers } = require('./manifests');

// Names differ between the two systems in small ways — nicknames (Al / Alcides),
// suffixes (Tamas Rati c/o Ontario Inc), and outright typos (Krzyanowski for
// Krzyzanowski). Exact normalised matching pairs most of the fleet; the rest are
// linked by hand once, in the UI, and stored in driver_eld_map.
const normalize = s => String(s ?? '').toUpperCase().replace(/[^A-Z ]/g, '').replace(/\s+/g, ' ').trim();

// Active RoseRocket driver profiles. A driver often has several profiles from past
// re-hires; exactly one is active and it is the one manifests are assigned to.
async function getRoseRocketDrivers() {
  const h = await headers();
  const rows = [];
  for (let offset = 0; ; offset += 200) {
    const res = await axios.get(`${BASE_URL}/api/v1/users`, { headers: h, params: { limit: 200, offset } });
    const users = res.data?.data?.users ?? [];
    rows.push(...users);
    if (users.length < 200) break;
  }
  return rows
    .filter(u => u.org_role_name === 'Driver' && u.user_status_id === 'active')
    .map(u => ({
      id: u.id,
      name: `${u.profile_first_name ?? ''} ${u.profile_last_name ?? ''}`.replace(/\s+/g, ' ').trim(),
      vehicle: u.equipment_names ?? null,
      email: u.email ?? null,
    }));
}

async function getStoredLinks() {
  const { rows } = await pool.query('SELECT rr_user_id, motive_id, link_set, enabled FROM driver_eld_map');
  return new Map(rows.map(r => [r.rr_user_id, {
    motiveId: r.motive_id === null ? null : Number(r.motive_id),
    linkSet: r.link_set,
    enabled: r.enabled,
  }]));
}

// The full pairing picture: every active RoseRocket driver, the Motive driver they are
// linked to, and how that link was arrived at. Pure, so it can be exercised without a
// database: a saved link always wins, otherwise we fall back to an exact name match.
function pairDrivers(rrDrivers, motiveDrivers, stored = new Map()) {
  const activeMotive = motiveDrivers.filter(m => m.active);
  const byName = new Map(activeMotive.map(m => [normalize(m.name), m]));
  const byId = new Map(motiveDrivers.map(m => [m.id, m]));

  const pairs = rrDrivers.map(rr => {
    const saved = stored.get(rr.id);
    const enabled = saved ? saved.enabled : true;

    // A link chosen by hand wins over the name match, and a link cleared by hand stays
    // cleared. Merely switching a driver off leaves link_set false, so their automatic
    // match is still there when they are switched back on.
    if (saved?.linkSet) {
      const m = saved.motiveId === null ? null : byId.get(saved.motiveId) ?? null;
      return { rr, motive: m, source: m ? 'saved' : 'unmatched', enabled };
    }
    const guess = byName.get(normalize(rr.name));
    return { rr, motive: guess ?? null, source: guess ? 'name' : 'unmatched', enabled };
  });

  const active = pairs.filter(p => p.enabled);
  const linkedMotiveIds = new Set(active.filter(p => p.motive).map(p => p.motive.id));
  return {
    pairs,
    unusedMotive: activeMotive.filter(m => !linkedMotiveIds.has(m.id)),
    counts: {
      total: pairs.length,
      included: active.length,
      excluded: pairs.length - active.length,
      linked: active.filter(p => p.motive).length,
      unmatched: active.filter(p => !p.motive).length,
    },
  };
}

async function buildPairing() {
  const [rrDrivers, motiveDrivers, stored] = await Promise.all([
    getRoseRocketDrivers(), motive.getDrivers(), getStoredLinks(),
  ]);
  return pairDrivers(rrDrivers, motiveDrivers, stored);
}

// Unlinking stores a null rather than deleting the row, so the driver does not silently
// re-link to the name guess and any enabled flag on that row survives.
async function setLink(rrUserId, motiveId) {
  await pool.query(
    `INSERT INTO driver_eld_map (rr_user_id, motive_id, link_set, updated_at)
     VALUES ($1, $2, TRUE, now())
     ON CONFLICT (rr_user_id) DO UPDATE
       SET motive_id = EXCLUDED.motive_id, link_set = TRUE, updated_at = now()`,
    [rrUserId, motiveId]);
}

// Switch a driver in or out of the hours tool. Owner-operator highway drivers are not on
// local manifests, so leaving them out keeps the preview to the drivers that matter.
async function setEnabled(rrUserId, enabled) {
  await pool.query(
    `INSERT INTO driver_eld_map (rr_user_id, motive_id, enabled, updated_at)
     VALUES ($1, NULL, $2, now())
     ON CONFLICT (rr_user_id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()`,
    [rrUserId, enabled]);
}

module.exports = { buildPairing, pairDrivers, setLink, setEnabled, getRoseRocketDrivers, getStoredLinks, normalize };
