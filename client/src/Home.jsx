import { ArrowRight } from 'lucide-react';
import { OrgBadges } from './ui';
import { FEATURES } from './features';

const ACCENTS = {
  blue:    { chip: 'bg-blue-50 text-blue-600',       hover: 'hover:border-blue-300' },
  emerald: { chip: 'bg-emerald-50 text-emerald-600', hover: 'hover:border-emerald-300' },
  amber:   { chip: 'bg-amber-50 text-amber-600',     hover: 'hover:border-amber-300' },
};

export default function Home({ onOpen }) {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-gray-900">RoseRocket Automation</h2>
        <p className="text-sm text-gray-400 mt-1">Pick a tool to get started</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 items-stretch">
        {FEATURES.map(f => {
          const accent = ACCENTS[f.accent] ?? ACCENTS.blue;
          const soon = f.status === 'soon';
          const Icon = f.icon;

          return (
            <button
              key={f.id}
              disabled={soon}
              onClick={() => onOpen(f.id)}
              // flex-col matters: a button centres its content vertically by default, so
              // in a stretched grid row the shorter card would sit lower than the taller
              // one and its padding would look wrong.
              className={`group flex flex-col h-full text-left bg-white rounded-2xl border border-gray-200 shadow-sm p-6 transition-all ${
                soon ? 'opacity-55 cursor-default' : `${accent.hover} hover:shadow-md`}`}
            >
              <div className="flex items-start gap-4 flex-1">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${accent.chip}`}>
                  <Icon size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-base font-semibold text-gray-900">{f.name}</p>
                    <OrgBadges orgs={f.orgs} />
                    {soon && (
                      <span className="text-xs bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full">Coming soon</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5">{f.blurb}</p>
                  <p className="text-sm text-gray-400 mt-3 leading-relaxed">{f.detail}</p>
                </div>
              </div>

              {!soon && (
                <div className="flex items-center gap-1.5 mt-auto pt-5 text-sm font-medium text-gray-400 group-hover:text-gray-700 transition-colors">
                  Open <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
