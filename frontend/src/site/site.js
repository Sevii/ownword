// Landing and information pages. A landing page hands pasted text to the
// editor through sessionStorage (same origin, this tab only): never through
// the URL, where it would reach server logs and browser history.

import '@fontsource/spectral/latin-400.css';
import '@fontsource/spectral/latin-600.css';
import '../app/styles.css';
import './site.css';
import { count } from '../app/telemetry.js';
import { HANDOFF_KEY } from './handoff.js';
import { documentProfile } from '../analysis/profile.js';
import { snapshotFromText } from '../analysis/snapshot/from-markdown.js';

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
  if (form.dataset.stats) {
    // Live counts on the page itself (plan §5.2); the same code as the editor's stats.
    const set = (name, value) => { const el = form.querySelector(`[data-stat="${name}"]`); if (el) el.textContent = value; };
    const level = (x) => (x >= 70 ? 'Easy' : x >= 50 ? 'Fairly standard' : x >= 30 ? 'Fairly difficult' : 'Difficult');
    const stats = () => {
      const p = documentProfile(snapshotFromText(box.value), {}, { protectedSpans: false });
      const c = p.counts;
      set('words', c.words.toLocaleString());
      set('characters', c.characters.toLocaleString());
      set('charactersNoSpaces', c.charactersNoSpaces.toLocaleString());
      set('sentences', c.sentences.toLocaleString());
      set('paragraphs', c.paragraphs.toLocaleString());
      set('readingTime', c.words ? `${Math.max(1, Math.round(c.readingMinutes))} min` : '0 min');
      set('meanSentence', `${Math.round(p.sentenceLengths.mean)} words`);
      set('maxSentence', `${p.sentenceLengths.max} words`);
      const score = p.readability.score;
      set('score', score === null ? '–' : `${Math.round(Math.max(0, Math.min(100, score)))}${p.readability.stable ? '' : ' (short sample)'}`);
      set('level', score === null ? '–' : level(score));
    };
    box.addEventListener('input', stats);
    stats();
  }
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
