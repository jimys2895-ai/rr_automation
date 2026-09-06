import { Zap, ArrowLeft } from 'lucide-react';
import { useRoute } from './router';
import { findFeature } from './features';
import { OrgBadges } from './ui';
import Home from './Home';

export default function App() {
  const [route, navigate] = useRoute();
  const feature = findFeature(route);
  const Page = feature?.component;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-3">
          <button onClick={() => navigate('')} className="flex items-center gap-3 group shrink-0">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
              <Zap size={15} className="text-white" />
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold text-gray-900 leading-none group-hover:text-blue-600 transition-colors">
                RoseRocket Automation
              </p>
              <p className="text-xs text-gray-400 mt-0.5">Contract Express</p>
            </div>
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {Page ? (
          <>
            {/* Which tool you are in, and the way back out. Driven by the registry, so a
                new feature gets this for free. */}
            <div className="flex items-center gap-3 mb-6">
              <button
                onClick={() => navigate('')}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 -ml-2.5 text-sm font-medium text-gray-500 rounded-lg hover:text-gray-900 hover:bg-gray-100 transition-colors"
              >
                <ArrowLeft size={14} /> Back
              </button>
              <span className="w-px h-5 bg-gray-200" />
              <h1 className="text-xl font-semibold text-gray-900">{feature.name}</h1>
              <OrgBadges orgs={feature.orgs} />
            </div>
            <Page />
          </>
        ) : (
          <Home onOpen={navigate} />
        )}
      </main>
    </div>
  );
}
