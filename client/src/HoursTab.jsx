import { useState, useCallback } from 'react';
import {
  ArrowRight, CheckCircle, AlertCircle, RotateCcw, Loader2,
  X, ChevronRight, ChevronDown, Pencil, Check, Download,
} from 'lucide-react';
import { Btn, Toast } from './ui';
import { download, previewRows, resultRows, PREVIEW_HEADER, RESULT_HEADER } from './exportCsv';
import * as api from './api';

const fmtHM = seconds => `${Math.floor(seconds / 3600)}h ${String(Math.round((seconds % 3600) / 60)).padStart(2, '0')}m`;

// ─── One proposed row ─────────────────────────────────────────────────────────
// The computed hours are a starting point, not the last word. A dispatcher who knows the
// day went differently can type the real figure before it reaches RoseRocket.
function DurationEditor({ seconds, onSave, onCancel }) {
  const [h, setH] = useState(Math.floor(seconds / 3600));
  const [m, setM] = useState(Math.round((seconds % 3600) / 60));

  const total = (Number(h) || 0) * 3600 + (Number(m) || 0) * 60;
  const valid = total > 0 && total <= 24 * 3600 && (Number(m) || 0) < 60;

  const box = 'w-14 px-1.5 py-1 text-sm text-center border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500';
  return (
    <span className="inline-flex items-center gap-1"
          onKeyDown={e => { if (e.key === 'Enter' && valid) onSave(total); if (e.key === 'Escape') onCancel(); }}>
      <input autoFocus type="number" min="0" max="24" value={h} onChange={e => setH(e.target.value)} className={box} />
      <span className="text-xs text-gray-400">h</span>
      <input type="number" min="0" max="59" step="5" value={m} onChange={e => setM(e.target.value)} className={box} />
      <span className="text-xs text-gray-400">m</span>
      <button onClick={() => valid && onSave(total)} disabled={!valid}
              className="p-1 rounded-md text-emerald-600 hover:bg-emerald-50 disabled:opacity-30" title="Use this value">
        <Check size={14} />
      </button>
      <button onClick={onCancel} className="p-1 rounded-md text-gray-400 hover:bg-gray-100" title="Cancel">
        <X size={14} />
      </button>
    </span>
  );
}

function ProposalRow({ row, rejected, onToggle, override, onOverride }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const w = row.computed.working;
  const seconds = override ?? row.computed.seconds;
  const edited = override != null && override !== row.computed.seconds;
  const delta = seconds - row.current.seconds;

  return (
    <div className={`bg-white rounded-xl border shadow-sm overflow-hidden transition-opacity ${
      rejected ? 'border-gray-200 opacity-50' : 'border-l-[3px] border-l-emerald-400 border-gray-200'}`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="text-xs font-mono text-gray-400 w-24 shrink-0">{row.date}</span>
        <span className={`text-sm font-semibold w-44 shrink-0 truncate ${rejected ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
          {row.driverName}
        </span>
        <a href={row.url} target="_blank" rel="noreferrer"
           className="text-xs text-blue-400 hover:text-blue-600 font-mono underline underline-offset-2 shrink-0">
          {row.fullId}
        </a>

        <span className="text-sm text-gray-400 ml-2">{row.current.formatted}</span>
        <ArrowRight size={12} className="text-gray-300" />

        {editing ? (
          <DurationEditor
            seconds={seconds}
            onSave={v => { onOverride(row.manifestId, v); setEditing(false); }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <>
            <button
              onClick={() => setEditing(true)}
              title="Edit these hours before applying"
              className="group/edit inline-flex items-center gap-1.5 px-1.5 py-0.5 -mx-1.5 rounded-md hover:bg-gray-100 transition-colors"
            >
              <span className="text-sm font-semibold text-gray-900">{fmtHM(seconds)}</span>
              <span className="text-xs text-gray-400">({Math.round((seconds / 3600) * 100) / 100})</span>
              <Pencil size={11} className="text-gray-300 group-hover/edit:text-gray-500" />
            </button>
            {edited && (
              <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full">
                edited from {row.computed.formatted}
                <button onClick={() => onOverride(row.manifestId, null)} title="Back to the calculated hours"
                        className="hover:text-blue-800"><RotateCcw size={10} /></button>
              </span>
            )}
            {delta !== 0 && (
              <span className={`text-xs font-medium ${delta > 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                {delta > 0 ? '+' : '-'}{fmtHM(Math.abs(delta))}
              </span>
            )}
          </>
        )}

        {!row.computed.onTime && (
          <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">
            late {row.computed.lateByMin}m
          </span>
        )}
        {row.docs?.agrees === false && (
          <span className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded-full">
            doc {row.docs.motive}
          </span>
        )}

        <button onClick={() => setOpen(o => !o)}
                className="ml-auto flex items-center gap-1 text-xs font-medium text-blue-400 hover:text-blue-600 shrink-0">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} working
        </button>
        <button onClick={() => onToggle(row.manifestId)}
                className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md transition-colors shrink-0 ${
                  rejected ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                           : 'bg-red-100 text-red-600 hover:bg-red-200'}`}>
          {rejected ? <><RotateCcw size={11} /> Approve</> : <><X size={11} /> Reject</>}
        </button>
      </div>

      {open && (
        <div className="px-4 pb-3 pt-2 border-t border-gray-50 bg-gray-50/40 text-xs text-gray-500 flex flex-wrap gap-x-6 gap-y-1">
          <span>scheduled start <b className="text-gray-700">{w.scheduled}</b></span>
          <span>went on duty <b className="text-gray-700">{w.firstOnDuty}</b></span>
          <span>last off duty <b className="text-gray-700">{w.lastOffDuty}</b></span>
          <span>counted <b className="text-gray-700">{w.startUsed} → {w.endUsed}</b></span>
          <span>Motive driver <b className="text-gray-700">{row.motiveDriver}</b></span>
          {row.docs?.motive && <span>shipping doc <b className="text-gray-700">{row.docs.motive}</b></span>}
        </div>
      )}
    </div>
  );
}

function Section({ title, count, tone = 'gray', children }) {
  const [open, setOpen] = useState(false);
  if (!count) return null;
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
              className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50">
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {title}
        <span className={`text-xs px-2 py-0.5 rounded-full ${
          tone === 'amber' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>{count}</span>
      </button>
      {open && <div className="border-t border-gray-100">{children}</div>}
    </div>
  );
}

// ─── Tab ──────────────────────────────────────────────────────────────────────
export default function HoursTab() {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate]     = useState('');
  const [phase, setPhase]         = useState('input');   // input|loading|preview|applying|done
  const [endRounding, setEndRounding] = useState('nearest');  // how the last off-duty is rounded
  const [data, setData]           = useState(null);
  const [rejected, setRejected]   = useState(new Set());
  const [overrides, setOverrides] = useState({});   // manifestId -> seconds typed by hand
  const [results, setResults]     = useState(null);
  const [toasts, setToasts]       = useState([]);

  const toast = useCallback((message, type = 'success') => {
    const id = Date.now() + Math.random();
    setToasts(p => [...p, { id, message, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4000);
  }, []);

  function toggle(id) {
    setRejected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function preview() {
    if (!startDate || !endDate) return toast('Pick a start and end date', 'error');
    setPhase('loading');
    try {
      setData(await api.previewHours({ startDate, endDate, endRounding }));
      setRejected(new Set());
      setOverrides({});
      setPhase('preview');
    } catch (e) { toast(e.message, 'error'); setPhase('input'); }
  }

  async function apply() {
    setPhase('applying');
    try {
      const approved = proposals.filter(r => !rejected.has(r.manifestId)).map(r => r.manifestId);
      const used = Object.fromEntries(approved.filter(id => overrides[id] != null).map(id => [id, overrides[id]]));
      setResults(await api.applyHours({ jobId: data.jobId, approvedManifestIds: approved, overrides: used }));
      setPhase('done');
    } catch (e) { toast(e.message, 'error'); setPhase('preview'); }
  }

  function reset() {
    setPhase('input'); setData(null); setResults(null); setRejected(new Set()); setOverrides({});
  }

  const rows       = data?.rows ?? [];
  const proposals  = rows.filter(r => r.status === 'propose');
  const edited     = rows.filter(r => r.status === 'already_edited');
  const unchanged  = rows.filter(r => r.status === 'unchanged');
  const flagged    = rows.filter(r => r.status === 'flag');
  const toWrite    = proposals.filter(r => !rejected.has(r.manifestId)).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Manifest Hours</h2>
        <p className="text-sm text-gray-400 mt-0.5">
          Read the day's hours from Motive and write them onto the matching manifest
        </p>
      </div>

      {(phase === 'input' || phase === 'loading') && (
        <>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <p className="text-sm font-semibold text-gray-700 mb-4">Date range</p>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1.5">Start Date</label>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                       className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <ArrowRight size={15} className="text-gray-300 mt-5 shrink-0" />
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1.5">End Date</label>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                       className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div className="mt-6 pt-5 border-t border-gray-100">
              <p className="text-xs text-gray-500 mb-2">End time rounding</p>
              <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
                {[['up', 'Up to the next 15 min'], ['nearest', 'To the nearest 15 min']].map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setEndRounding(value)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      endRounding === value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-2">
                A driver going off duty at 16:32 ends at 16:45 rounding up, or 16:30 rounding to the nearest.
                The start time is unaffected either way.
              </p>
            </div>

            <p className="text-xs text-gray-400 mt-5">
              Completed manifests only. Anything already edited by hand is left untouched, and miles are never changed.
            </p>
          </div>

          <div className="flex justify-end">
            <Btn onClick={preview} disabled={phase === 'loading'} className="px-6 py-2.5">
              {phase === 'loading'
                ? <><Loader2 size={14} className="animate-spin" /> Reading Motive</>
                : <>Preview <ArrowRight size={14} /></>}
            </Btn>
          </div>
        </>
      )}

      {(phase === 'preview' || phase === 'applying') && data && (
        <>
          <div className="bg-green-900 rounded-xl px-5 py-4 flex items-center gap-4 text-sm flex-wrap">
            <span className="font-semibold text-white">{data.startDate}</span>
            <ArrowRight size={12} className="text-gray-500" />
            <span className="font-semibold text-white">{data.endDate}</span>
            <div className="h-4 w-px bg-green-300 hidden sm:block" />
            <span className="inline-flex items-center gap-1.5">
              <span className="font-bold text-green-300">{toWrite}</span>
              <span className="text-gray-300">manifest{toWrite !== 1 ? 's' : ''} to update</span>
            </span>
            <span className="text-gray-300">
              end {data.endRounding === 'nearest' ? 'rounded to nearest 15 min' : 'rounded up to next 15 min'}
            </span>
            {edited.length > 0 && <span className="text-gray-300">{edited.length} already set by hand</span>}
            {flagged.length > 0 && <span className="text-amber-300">{flagged.length} need a look</span>}
            <button
              onClick={() => download(
                `manifest-hours ${data.startDate} to ${data.endDate}.csv`,
                [PREVIEW_HEADER, ...previewRows(data, { overrides, rejected })])}
              className="ml-auto flex items-center gap-1.5 text-green-300 hover:text-green-500"
            >
              <Download size={11} /> Export
            </button>
            <button onClick={reset} className="flex items-center gap-1.5 text-green-300 hover:text-green-500">
              <RotateCcw size={11} /> Start over
            </button>
          </div>

          {data.warnings?.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <div className="flex items-center gap-2 text-amber-700 text-sm font-semibold mb-2">
                <AlertCircle size={14} /> Warnings
              </div>
              <ul className="space-y-1">
                {data.warnings.map((w, i) => (
                  <li key={i} className="text-sm text-amber-600 flex items-start gap-2">
                    <span className="text-amber-400 shrink-0 mt-0.5">•</span>{w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {proposals.length === 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center text-sm text-gray-400">
              Nothing to write for this range.
            </div>
          )}

          <div className="space-y-2">
            {proposals.map(r => (
              <ProposalRow
                key={r.manifestId}
                row={r}
                rejected={rejected.has(r.manifestId)}
                onToggle={toggle}
                override={overrides[r.manifestId]}
                onOverride={(id, v) => setOverrides(p => {
                  const next = { ...p };
                  if (v == null) delete next[id]; else next[id] = v;
                  return next;
                })}
              />
            ))}
          </div>

          <Section title="Needs a look" count={flagged.length} tone="amber">
            {flagged.map((r, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2.5 border-t border-gray-50 first:border-t-0 text-sm">
                <span className="text-xs font-mono text-gray-400 w-24 shrink-0">{r.date}</span>
                <span className="text-gray-900 w-44 shrink-0 truncate">{r.driverName}</span>
                {r.url
                  ? <a href={r.url} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:text-blue-600 font-mono underline underline-offset-2 w-24 shrink-0">{r.fullId}</a>
                  : <span className="text-xs text-gray-300 w-24 shrink-0">{r.fullId ?? '-'}</span>}
                <span className="text-xs text-amber-600">{r.reason}</span>
              </div>
            ))}
          </Section>

          <Section title="Already set by hand, left alone" count={edited.length}>
            {edited.map((r, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2.5 border-t border-gray-50 first:border-t-0 text-sm">
                <span className="text-xs font-mono text-gray-400 w-24 shrink-0">{r.date}</span>
                <span className="text-gray-900 w-44 shrink-0 truncate">{r.driverName}</span>
                <span className="text-xs text-blue-400 font-mono w-24 shrink-0">{r.fullId}</span>
                <span className="text-gray-500">on the manifest <b className="text-gray-700">{r.current.formatted}</b></span>
                {r.computed && r.computed.seconds !== r.current.seconds && (
                  <span className="text-xs text-gray-400">Motive would give {r.computed.formatted}</span>
                )}
              </div>
            ))}
          </Section>

          <Section title="Already correct" count={unchanged.length}>
            {unchanged.map((r, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2.5 border-t border-gray-50 first:border-t-0 text-sm">
                <span className="text-xs font-mono text-gray-400 w-24 shrink-0">{r.date}</span>
                <span className="text-gray-900 w-44 shrink-0 truncate">{r.driverName}</span>
                <span className="text-gray-500">{r.current.formatted}</span>
              </div>
            ))}
          </Section>

          {toWrite > 0 && (
            <div className="flex justify-end">
              <Btn onClick={apply} disabled={phase === 'applying'} className="px-6 py-2.5">
                {phase === 'applying'
                  ? <><Loader2 size={14} className="animate-spin" /> Writing</>
                  : <>Apply {toWrite} to RoseRocket <ArrowRight size={14} /></>}
              </Btn>
            </div>
          )}
        </>
      )}

      {phase === 'done' && results && (
        <>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {results.results.length === 0 && (
              <p className="px-4 py-6 text-sm text-gray-400 text-center">Nothing was written.</p>
            )}
            {results.results.map((r, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3 border-t border-gray-100 first:border-t-0">
                {r.status === 'updated'
                  ? <CheckCircle size={15} className="text-emerald-500 shrink-0" />
                  : <AlertCircle size={15} className="text-red-500 shrink-0" />}
                <span className="text-xs font-mono text-gray-400 w-24 shrink-0">{r.date}</span>
                <span className="text-sm font-medium text-gray-900 w-44 shrink-0 truncate">{r.driverName}</span>
                <span className="text-xs text-blue-400 font-mono w-24 shrink-0">{r.fullId}</span>
                {r.status === 'updated'
                  ? <span className="text-sm text-gray-500">
                      {fmtHM(r.from ?? 0)} to <b className="text-gray-900">{r.formatted}</b>
                      {r.edited && <span className="ml-2 text-xs text-blue-600">edited, calculated {r.computedFormatted}</span>}
                    </span>
                  : <span className="text-xs text-red-500">{r.message}</span>}
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Btn variant="secondary"
                 onClick={() => download(`manifest-hours applied ${new Date().toISOString().slice(0, 10)}.csv`,
                                         [RESULT_HEADER, ...resultRows(results.results)])}>
              <Download size={13} /> Export
            </Btn>
            <Btn variant="secondary" onClick={reset}><RotateCcw size={13} /> Run another range</Btn>
          </div>
        </>
      )}

      <Toast toasts={toasts} />
    </div>
  );
}
