import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthProvider, useAuth } from './auth';
import { I18nProvider, useT } from './i18n';
import { partitionFor } from './lib/auth';
import { StoreProvider } from './store';
import './styles.css';

/** Mounts the data layer for the current account (or local-only). A new key remounts it on account switch,
 *  so no state, cache or pending write of one account can leak into another. */
function Root() {
  const { state } = useAuth();
  const t = useT();
  if (state.status === 'loading') return <div className="center-screen" aria-busy="true"><span className="spinner" aria-label={t.common.loading} /></div>;
  const p = partitionFor(state);
  return (
    <StoreProvider key={p.name} partition={p}>
      <App />
    </StoreProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <AuthProvider>
        <Root />
      </AuthProvider>
    </I18nProvider>
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // A new version installs in the background and is used from the next app start. The running page keeps its
  // code, so no reload interrupts a save; data lives in IndexedDB (incl. the sync outbox), never in the SW cache.
  window.addEventListener('load', () =>
    navigator.serviceWorker.register('./sw.js').then(
      // Installed iPhone apps stay open for days: also look for updates when the app comes back to the front.
      (reg) => document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && reg.update().catch(() => {})),
      () => {},
    ),
  );
}
// On-screen keyboard: iOS Safari keeps the layout viewport, so bottom sheets would sit behind the keyboard.
// Expose the covered height as --kb; sheets are lifted by it.
const vv = window.visualViewport;
if (vv) {
  const onVV = () => document.documentElement.style.setProperty('--kb', `${Math.max(0, window.innerHeight - vv.height - vv.offsetTop)}px`);
  vv.addEventListener('resize', onVV);
  vv.addEventListener('scroll', onVV);
}
// Ask the browser not to evict our IndexedDB under storage pressure (best effort; Safari may ignore it).
navigator.storage?.persist?.().catch(() => {});
