const BASE = '/api';

async function req(url, opts = {}) {
  const res  = await fetch(`${BASE}${url}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const json = body => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Drivers
export const getDrivers       = ()           => req('/drivers');
export const createDriver     = d            => req('/drivers',                          { method: 'POST',   ...json(d) });
export const updateDriver     = (uid, d)     => req(`/drivers/${encodeURIComponent(uid)}`, { method: 'PUT',  ...json(d) });
export const deleteDriver     = uid          => req(`/drivers/${encodeURIComponent(uid)}`, { method: 'DELETE' });
export const deleteDrivers    = unitIds      => req('/drivers',                          { method: 'DELETE', ...json({ unitIds }) });
export const deleteAllDrivers = ()           => req('/drivers',                          { method: 'DELETE', ...json({ all: true }) });

// Transponders
export const getTransponders       = ()         => req('/transponders');
export const createTransponder     = d          => req('/transponders',                              { method: 'POST',   ...json(d) });
export const updateTransponder     = (txp, d)   => req(`/transponders/${encodeURIComponent(txp)}`,   { method: 'PUT',    ...json(d) });
export const deleteTransponder     = txp        => req(`/transponders/${encodeURIComponent(txp)}`,   { method: 'DELETE' });
export const deleteTransponders    = list       => req('/transponders',                              { method: 'DELETE', ...json({ transponders: list }) });
export const deleteAllTransponders = ()         => req('/transponders',                              { method: 'DELETE', ...json({ all: true }) });

// Process
export const processCharges = formData => req('/process', { method: 'POST', body: formData });
export const confirmCharges = (jobId, ignoredBillIds) => req('/confirm', { method: 'POST', ...json({ jobId, ignoredBillIds: [...ignoredBillIds] }) });

// Manifest hours (Motive → RoseRocket)
export const getHoursDrivers  = ()                  => req('/hours/drivers');
export const updateHoursDriver = (rrUserId, patch) => req(`/hours/drivers/${encodeURIComponent(rrUserId)}`, { method: 'PUT', ...json(patch) });
export const previewHours     = body                => req('/hours/preview', { method: 'POST', ...json(body) });
export const applyHours       = body                => req('/hours/apply',   { method: 'POST', ...json(body) });
