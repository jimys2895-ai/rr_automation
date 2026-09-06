import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, X, Loader2 } from 'lucide-react';
import { Btn, Modal, Field, TextInput, Toast } from './ui';
import * as api from './api';

export default function DriversTab() {
  const [drivers, setDrivers]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [selected, setSelected]     = useState(new Set());
  const [modal, setModal]           = useState(null); // 'add'|'edit'|'delete'
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm]             = useState({ unit_id: '', name: '', rr_id: '' });
  const [saving, setSaving]         = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [toasts, setToasts]         = useState([]);

  const toast = useCallback((message, type = 'success') => {
    const id = Date.now() + Math.random();
    setToasts(p => [...p, { id, message, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500);
  }, []);

  async function load() {
    setLoading(true);
    try { setDrivers(await api.getDrivers()); }
    catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const allSelected = drivers.length > 0 && selected.size === drivers.length;
  const toggleAll   = () => setSelected(allSelected ? new Set() : new Set(drivers.map(d => d.unit_id)));
  const toggle      = id => setSelected(p => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s; });

  function openAdd() {
    setForm({ unit_id: '', name: '', rr_id: '' });
    setEditTarget(null);
    setModal('add');
  }

  function openEdit(d) {
    setForm({ unit_id: d.unit_id, name: d.name, rr_id: d.rr_id || '' });
    setEditTarget(d);
    setModal('edit');
  }

  async function save() {
    if (!form.unit_id.trim() || !form.name.trim()) { toast('Unit ID and Name are required', 'error'); return; }
    setSaving(true);
    try {
      if (editTarget) {
        await api.updateDriver(editTarget.unit_id, { name: form.name, rr_id: form.rr_id });
        toast('Driver updated');
      } else {
        await api.createDriver(form);
        toast('Driver added');
      }
      setModal(null);
      load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  }

  function askDelete(target) { setDeleteTarget(target); setModal('delete'); }

  async function confirmDelete() {
    try {
      if (deleteTarget === 'all') {
        await api.deleteAllDrivers();
        setSelected(new Set());
        toast('All drivers deleted');
      } else if (deleteTarget === 'selected') {
        await api.deleteDrivers([...selected]);
        setSelected(new Set());
        toast(`${selected.size} driver(s) deleted`);
      } else {
        await api.deleteDriver(deleteTarget);
        setSelected(p => { const s = new Set(p); s.delete(deleteTarget); return s; });
        toast('Driver deleted');
      }
      setModal(null);
      load();
    } catch (e) { toast(e.message, 'error'); }
  }

  const deleteLabel =
    deleteTarget === 'all'      ? `Delete all ${drivers.length} drivers?` :
    deleteTarget === 'selected' ? `Delete ${selected.size} selected driver(s)?` :
    `Delete driver "${drivers.find(d => d.unit_id === deleteTarget)?.name}"?`;

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Drivers</h2>
          <p className="text-sm text-gray-400 mt-0.5">{drivers.length} configured</p>
        </div>
        <div className="flex items-center gap-2">
          <Btn onClick={openAdd}><Plus size={13} /> Add Driver</Btn>
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-xl text-sm">
          <span className="text-sm font-medium text-blue-700">{selected.size} selected</span>
          <div className="h-3 w-px bg-blue-200" />
          <Btn variant="danger" size="sm" onClick={() => askDelete('selected')}><Trash2 size={12} /> Delete Selected</Btn>
          <Btn variant="danger" size="sm" onClick={() => askDelete('all')}>Delete All</Btn>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-blue-400 hover:text-blue-600 p-1 rounded transition-colors">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-24 text-gray-400 text-sm">
            <Loader2 size={18} className="animate-spin" /> Loading...
          </div>
        ) : drivers.length === 0 ? (
          <div className="text-center py-24 text-gray-400">
            <p className="text-sm font-medium">No drivers configured</p>
            <p className="text-xs mt-1 text-gray-300">Add a driver manually</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="w-12 px-4 py-3">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer" />
                </th>
                {['Unit ID', 'Name', 'RR Driver ID'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                ))}
                <th className="w-20 px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {drivers.map(d => (
                <tr key={d.unit_id}
                  className={`border-t border-gray-100 transition-colors ${selected.has(d.unit_id) ? 'bg-blue-50/60' : 'hover:bg-gray-50'}`}>
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selected.has(d.unit_id)} onChange={() => toggle(d.unit_id)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer" />
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex px-2 py-0.5 rounded-md bg-gray-100 text-xs font-mono font-medium text-gray-700">{d.unit_id}</span>
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{d.name}</td>
                  <td className="px-4 py-3">
                    {d.rr_id && <span className="text-xs font-mono text-gray-400 truncate block max-w-xs" title={d.rr_id}>{d.rr_id}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Btn variant="ghost" size="sm" onClick={() => openEdit(d)}><Pencil size={13} /></Btn>
                      <Btn variant="ghost" size="sm" onClick={() => askDelete(d.unit_id)} className="hover:text-red-600 hover:bg-red-50">
                        <Trash2 size={13} />
                      </Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add / Edit modal */}
      {(modal === 'add' || modal === 'edit') && (
        <Modal title={modal === 'add' ? 'Add Driver' : 'Edit Driver'} onClose={() => setModal(null)}>
          <div className="px-6 py-5 space-y-4">
            <Field label="Unit ID" required>
              <TextInput value={form.unit_id} placeholder="e.g. 9681"
                onChange={e => setForm(f => ({ ...f, unit_id: e.target.value }))}
                disabled={modal === 'edit'} />
            </Field>
            <Field label="Name" required hint="Must match the driver's company name in RoseRocket (case-insensitive)">
              <TextInput value={form.name} placeholder="e.g. Michael Lumley"
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </Field>
            <Field label="RR Driver ID" hint="UUID from RoseRocket. Used as a fallback if the name does not match">
              <TextInput value={form.rr_id} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                onChange={e => setForm(f => ({ ...f, rr_id: e.target.value }))} />
            </Field>
          </div>
          <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
            <Btn variant="secondary" onClick={() => setModal(null)}>Cancel</Btn>
            <Btn onClick={save} disabled={saving}>
              {saving && <Loader2 size={13} className="animate-spin" />} Save
            </Btn>
          </div>
        </Modal>
      )}

      {/* Delete confirm */}
      {modal === 'delete' && (
        <Modal title="Confirm Delete" onClose={() => setModal(null)}>
          <div className="px-6 py-5">
            <p className="text-sm text-gray-600">{deleteLabel} This cannot be undone.</p>
          </div>
          <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
            <Btn variant="secondary" onClick={() => setModal(null)}>Cancel</Btn>
            <Btn variant="danger" onClick={confirmDelete}><Trash2 size={13} /> Delete</Btn>
          </div>
        </Modal>
      )}

      <Toast toasts={toasts} />
    </div>
  );
}
