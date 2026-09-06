import { useState, useEffect, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { Toast } from './ui';
import * as api from './api';

// A driver switched off here is left out of the hours tool entirely. Owner-operator
// highway drivers are not on local manifests, so keeping them out of the preview leaves
// only the drivers the tool is meant to handle.
function Switch({ on, busy, onClick, label }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={on ? 'Included. Click to leave this driver out.' : 'Left out. Click to include this driver.'}
      className={`relative w-9 h-5 rounded-full shrink-0 transition-colors disabled:opacity-50 ${
        on ? 'bg-emerald-500' : 'bg-gray-200'}`}
    >
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
        on ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  );
}

export default function DriverLinksTab() {
  const [data, setData]     = useState(null);
  const [saving, setSaving] = useState(null);
  const [toasts, setToasts] = useState([]);

  const toast = useCallback((message, type = 'success') => {
    const id = Date.now() + Math.random();
    setToasts(p => [...p, { id, message, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4000);
  }, []);

  const load = useCallback(async () => {
    try { setData(await api.getHoursDrivers()); }
    catch (e) { toast(e.message, 'error'); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  async function save(rrUserId, patch, message) {
    setSaving(rrUserId);
    try {
      await api.updateHoursDriver(rrUserId, patch);
      await load();
      if (message) toast(message);
    } catch (e) { toast(e.message, 'error'); }
    finally { setSaving(null); }
  }

  const counts = data?.counts;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Driver Links</h2>
        <p className="text-sm text-gray-400 mt-0.5">
          Choose which drivers the hours tool handles, and pair each one with their Motive driver
        </p>
      </div>

      {!data ? (
        <div className="flex justify-center py-16">
          <Loader2 size={20} className="animate-spin text-gray-300" />
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4 flex items-center gap-4 text-sm flex-wrap">
            <span className="text-gray-500">
              <b className="text-gray-900">{counts.included}</b> of {counts.total} drivers included
            </span>
            {counts.excluded > 0 && <span className="text-gray-400">{counts.excluded} left out</span>}
            <span className="text-gray-500"><b className="text-gray-900">{counts.linked}</b> linked to Motive</span>
            {counts.unmatched > 0 && (
              <span className="text-amber-600">
                {counts.unmatched} included but not linked. Either pick their Motive driver or switch them off.
              </span>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {data.drivers.map(d => (
              <div
                key={d.rrUserId}
                className={`flex items-center gap-3 px-4 py-2.5 border-t border-gray-50 first:border-t-0 transition-opacity ${
                  d.enabled ? '' : 'opacity-45'}`}
              >
                <Switch
                  on={d.enabled}
                  busy={saving === d.rrUserId}
                  label={`Include ${d.rrName}`}
                  onClick={() => save(d.rrUserId, { enabled: !d.enabled },
                    d.enabled ? `${d.rrName} left out` : `${d.rrName} included`)}
                />
                <span className="text-sm text-gray-900 flex-1 truncate" title={d.rrName}>{d.rrName}</span>
                {d.vehicle && <span className="text-xs text-gray-400 font-mono shrink-0">{d.vehicle}</span>}
                {d.enabled && !d.motiveId && (
                  <span className="text-xs text-amber-600 shrink-0">not linked</span>
                )}
                <select
                  value={d.motiveId ?? ''}
                  disabled={saving === d.rrUserId || !d.enabled}
                  onChange={e => save(d.rrUserId, { motiveId: e.target.value ? Number(e.target.value) : null }, 'Link saved')}
                  className="text-sm border border-gray-200 rounded-lg px-2 py-1 w-60 shrink-0 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
                >
                  <option value="">Not linked</option>
                  {d.motiveId && <option value={d.motiveId}>{d.motiveName}</option>}
                  {data.unusedMotive.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <span className="text-xs text-gray-300 w-12 shrink-0">
                  {d.source === 'name' ? 'auto' : d.source === 'saved' ? 'saved' : ''}
                </span>
              </div>
            ))}
          </div>

          {data.unusedMotive.length > 0 && (
            <p className="text-xs text-gray-400">
              Active in Motive but not linked to anyone: {data.unusedMotive.map(m => m.name).join(', ')}
            </p>
          )}
        </>
      )}

      <Toast toasts={toasts} />
    </div>
  );
}
