// Install and update prompts (improvement plan §5.3). The install offer
// appears once, from the second visit, and only when the browser says the
// app can be installed. The update toast appears when a new service worker
// takes over a page that an older one was serving.

import { useEffect, useState } from 'react';

const VISITS = 'ow:visits';
const DISMISSED = 'ow:install-dismissed';
const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };

export function useInstallPrompt() {
  const [event, setEvent] = useState(/** @type {any} */ (null));
  const [dismissed, setDismissed] = useState(() => read(DISMISSED) === '1');
  const [visits] = useState(() => {
    const n = Number(read(VISITS) ?? 0) + 1;
    write(VISITS, String(n));
    return n;
  });
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    const onPrompt = (e) => {
      e.preventDefault();
      setEvent(e);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', () => setEvent(null));
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw) return undefined;
    // A page that had no controller is a first install, not an update.
    const hadController = Boolean(sw.controller);
    const onChange = () => { if (hadController) setUpdateReady(true); };
    sw.addEventListener('controllerchange', onChange);
    return () => sw.removeEventListener('controllerchange', onChange);
  }, []);

  async function install() {
    if (!event) return;
    event.prompt();
    const choice = await event.userChoice.catch(() => ({ outcome: 'dismissed' }));
    setEvent(null);
    if (choice?.outcome !== 'accepted') dismiss();
  }

  function dismiss() {
    write(DISMISSED, '1');
    setDismissed(true);
  }

  return {
    canInstall: Boolean(event) && visits >= 2 && !dismissed,
    install,
    dismiss,
    updateReady,
    reload: () => window.location.reload(),
  };
}
