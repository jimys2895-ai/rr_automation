import { useState, useEffect, useCallback } from 'react';

// Real paths rather than a #/hash, using the History API. No router library needed: the
// server already serves index.html for any path it does not recognise, so /charges loads
// directly and a refresh or a bookmark works.
const currentId = () => window.location.pathname.replace(/^\/+|\/+$/g, '');

// Links handed out while the app used hash routing still arrive as /#/charges. Rewrite
// those to the clean path once, so an old bookmark lands on the right page.
function adoptLegacyHash() {
  const hash = window.location.hash;
  if (!hash) return null;
  const id = hash.replace(/^#\/?/, '').split('?')[0].replace(/\/+$/, '');
  window.history.replaceState({}, '', id ? `/${id}` : '/');
  return id;
}

export function useRoute() {
  const [route, setRoute] = useState(() => adoptLegacyHash() ?? currentId());

  useEffect(() => {
    const onPop = () => setRoute(currentId());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback(id => {
    const path = id ? `/${id}` : '/';
    if (window.location.pathname !== path) window.history.pushState({}, '', path);
    setRoute(id);
    window.scrollTo(0, 0);
  }, []);

  return [route, navigate];
}
