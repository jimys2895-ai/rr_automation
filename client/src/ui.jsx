import { createPortal } from 'react-dom';
import { X, CheckCircle, AlertCircle } from 'lucide-react';

// Overlays are rendered into <body> rather than where they are written. A fixed overlay
// left in the tree inherits whatever its ancestors impose — a `space-y-*` parent puts a
// top margin on it, which shifts `inset-0` down and leaves an undimmed strip at the top of
// the screen, and an ancestor with a transform would reposition it entirely.
const overlay = node =>
  (typeof document !== 'undefined' && document.body) ? createPortal(node, document.body) : node;

// Which RoseRocket org a tool acts on. A tool covering both shows both badges.
export function OrgBadges({ orgs = [], className = '' }) {
  if (!orgs.length) return null;
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {orgs.map(org => (
        <span
          key={org}
          title={org === 'CET' ? 'CE Trucking' : org === 'CEL' ? 'CE Logistics' : org}
          className="text-[10px] font-semibold tracking-wide px-1.5 py-0.5 rounded border border-gray-200 bg-gray-50 text-gray-500"
        >
          {org}
        </span>
      ))}
    </span>
  );
}

export function Btn({ children, variant = 'primary', size = 'md', disabled, onClick, type = 'button', className = '' }) {
  const base = 'inline-flex items-center gap-1.5 font-medium transition-colors rounded-lg disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-1 whitespace-nowrap';
  const sizes  = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm' };
  const variants = {
    primary:   'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-400',
    secondary: 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 focus:ring-gray-200',
    danger:    'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 focus:ring-red-300',
    ghost:     'text-gray-500 hover:text-gray-800 hover:bg-gray-100 focus:ring-gray-200',
  };
  return (
    <button type={type} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

export function Modal({ title, onClose, children, width = 'max-w-md' }) {
  return overlay(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-white rounded-2xl shadow-2xl w-full ${width} max-h-[90vh] flex flex-col`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, required, hint, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

export function TextInput(props) {
  return (
    <input
      {...props}
      className={`w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-400 disabled:bg-gray-50 disabled:text-gray-500 ${props.className ?? ''}`}
    />
  );
}

export function Toast({ toasts }) {
  if (!toasts.length) return null;
  return overlay(
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-900 shadow-xl text-sm font-medium text-white pointer-events-auto min-w-[220px] max-w-sm">
          {t.type === 'success' ? <CheckCircle size={15} className="text-emerald-400 shrink-0" /> :
           t.type === 'error'   ? <AlertCircle  size={15} className="text-red-400 shrink-0" /> :
                                  <AlertCircle  size={15} className="text-amber-400 shrink-0" />}
          <span className="leading-snug">{t.message}</span>
        </div>
      ))}
    </div>
  );
}


// Sub-navigation inside a feature page. Kept here so every feature's internal tabs look
// the same as the next one's.
export function SubTabs({ tabs, active, onChange }) {
  return (
    <div className="border-b border-gray-200 mb-6">
      <nav className="flex -mb-px">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              active === id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {Icon && <Icon size={14} />}
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
