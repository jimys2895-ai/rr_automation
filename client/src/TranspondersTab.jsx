import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, X, Loader2 } from 'lucide-react';
import { Btn, Modal, Field, TextInput, Toast } from './ui';
import * as api from './api';

export default function TranspondersTab() {
  const [rows, setRows]             = useState([]);
  const [loading, setLoading]       = useState(true);
  const [selected, setSelected]     = useState(new Set());
  const [modal, setModal]           = useState(null); // 'add'|'edit'|'delete'
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm]             = useState({ transponder: '', unit_id: '' });
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
    try { setRows(await api.getTransponders()); }
    catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const toggleAll   = () => setSelected(allSelected ? new Set() : new Set(rows.map(r => r.transponder)));
  const toggle      = key => setSelected(p => { const s = new Set(p); s.has(key) ? s.delete(key) : s.add(key); return s; });

  function openAdd() { setForm({ transponder: '', unit_id: '' }); setEditTarget(null); setModal('add'); }
  function openEdit(r) { setForm({ transponder: r.transponder, unit_id: r.unit_id }); setEditTarget(r); setModal('edit'); }
  function askDelete(t) { setDeleteTarget(t); setModal('delete'); }

  async function save() {
    if (!form.transponder.trim() || !form.unit_id.trim()) { toast('Both fields are required', 'error'); return; }
    setSaving(true);
    try {
      if (editTarget) {
        await api.updateTransponder(editTarget.transponder, form);
        toast('Transponder updated');
      } else {
        await api.createTransponder(form);
        toast('Transponder added');
      }
      setModal(null);
      load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  }

  async function confirmDelete() {
    try {
      if (deleteTarget === 'all') {
        await api.deleteAllTransponders();
        setSelected(new Set());
        toast('All transponders deleted');
      } else if (deleteTarget === 'selected') {
        await api.deleteTransponders([...selected]);
        setSelected(new Set());
        toast(`${selected.size} transponder(s) deleted`);
      } else {
        await api.deleteTransponder(deleteTarget);
        setSelected(p => { const s = new Set(p); s.delete(deleteTarget); return s; });
        toast('Transponder deleted');
      }
      setModal(null);
      load();
    } catch (e) { toast(e.message, 'error'); }
  }

  const deleteLabel =
    deleteTarget === 'all'      ? `Delete all ${rows.length} transponders?` :
    deleteTarget === 'selected' ? `Delete ${selected.size} selected transponder(s)?` :
    `Delete transponder "${deleteTarget}"?`;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Transponders</h2>
          <p className="text-sm text-gray-400 mt-0.5">{rows.length} configured</p>
        </div>
        <Btn onClick={openAdd}><Plus size={13} /> Add Transponder</Btn>
      </div>

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

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-24 text-gray-400 text-sm">
            <Loader2 size={18} className="animate-spin" /> Loading...
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-24 text-gray-400">
            <p className="text-sm font-medium">No transponders configured</p>
            <p className="text-xs mt-1 text-gray-300">Add transponders to map bridge/toll tags to truck units</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="w-12 px-4 py-3">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer" />
                </th>
                {['Transponder ID', 'Unit ID'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                ))}
                <th className="w-20 px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.transponder}
                  className={`border-t border-gray-100 transition-colors ${selected.has(r.transponder) ? 'bg-blue-50/60' : 'hover:bg-gray-50'}`}>
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selected.has(r.transponder)} onChange={() => toggle(r.transponder)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer" />
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm font-mono text-gray-900">{r.transponder}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex px-2 py-0.5 rounded-md bg-gray-100 text-xs font-mono font-medium text-gray-700">{r.unit_id}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Btn variant="ghost" size="sm" onClick={() => openEdit(r)}><Pencil size={13} /></Btn>
                      <Btn variant="ghost" size="sm" onClick={() => askDelete(r.transponder)} className="hover:text-red-600 hover:bg-red-50">
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

      {(modal === 'add' || modal === 'edit') && (
        <Modal title={modal === 'add' ? 'Add Transponder' : 'Edit Transponder'} onClose={() => setModal(null)}>
          <div className="px-6 py-5 space-y-4">
            <Field label="Transponder ID" required hint="Exact ID as shown in the BlueWater CSV (e.g. 25290001071808 or 19E100054E1)">
              <TextInput value={form.transponder} placeholder="e.g. 25290001071808"
                onChange={e => setForm(f => ({ ...f, transponder: e.target.value.trim() }))}
                disabled={modal === 'edit'} />
            </Field>
            <Field label="Unit ID" required hint="Truck unit number from the driver map">
              <TextInput value={form.unit_id} placeholder="e.g. 9681"
                onChange={e => setForm(f => ({ ...f, unit_id: e.target.value.trim() }))} />
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
