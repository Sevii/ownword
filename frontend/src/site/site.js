// Landing and information pages. A landing page hands pasted text to the
// editor through sessionStorage (same origin, this tab only): never through
// the URL, where it would reach server logs and browser history.

import '@fontsource/spectral/latin-400.css';
import '@fontsource/spectral/latin-600.css';
import '../app/styles.css';
import './site.css';
import { count } from '../app/telemetry.js';
import { HANDOFF_KEY } from './handoff.js';

const page = document.body.dataset.page;
const form = document.querySelector('[data-handoff]');

if (form && page) {
  count(`landing.${page}.viewed`);
  const box = form.querySelector('textarea');
  const button = form.querySelector('button');
  const update = () => {
    button.disabled = !box.value.trim();
  };
  box.addEventListener('input', update);
  update();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = box.value.trim();
    if (!text) return;
    count(`landing.${page}.started`);
    try {
      sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ text, source: page, intent: form.dataset.handoff }));
    } catch {
      // Storage blocked: the editor still opens, empty.
    }
    window.location.assign(import.meta.env.BASE_URL);
  });
}
