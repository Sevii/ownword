import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { editorExtensions, issueKey, issueDecorations, issueRanges, mapIssueRanges, ENSURE_BLOCK_IDS } from '../editor/extensions.js';
import { snapshotFromDoc } from '../editor/snapshot-from-editor.js';
import { applyReplacement } from '../editor/apply-edit.js';
import { sanitizeDocJson, sanitizePastedHtml } from '../editor/sanitize.js';
import { createScheduler } from '../proofreading/scheduler.js';
import { dismissalFor, applySuppressions } from '../analysis/issues/dismissals.js';
import { mergeIssues } from '../analysis/issues/merge.js';
import { countWords } from '../analysis/text/segment.js';
import { reanchor } from '../ai/reanchor.js';
import { documentProfile } from '../analysis/profile.js';
import * as db from '../documents/db.js';
import { toPlainText, toMarkdown, toDocx, docxToHtml, download, safeFilename } from '../documents/export.js';
import { count } from './telemetry.js';
import { AssistPanel } from './AssistPanel.jsx';
import { IssuePopover } from './IssuePopover.jsx';
import { SettingsDialog } from './SettingsDialog.jsx';
import { Sidebar } from './Sidebar.jsx';
import { Topbar } from './Topbar.jsx';
import { FormatBar } from './FormatBar.jsx';
import { AiPanel } from './AiPanel.jsx';
import { useAiReview } from './useAiReview.js';
import { IconReview } from './icons.jsx';
import { CHECK_STATUS_LABELS } from './labels.js';
import { WELCOME_HTML, WELCOME_TITLE } from './welcome.js';
import { takeHandoff, textToHtml, linesText, titleFrom } from '../site/handoff.js';
import * as connections from '../ai/connections.js';

const DEFAULT_PREFS = { dialect: 'en-US', dictionary: [], disabledRules: [], longSentenceWords: 30, paused: false };
const SAVE_DEBOUNCE_MS = 600;
const RECOVERY_EVERY_MS = 5 * 60_000;
const MAX_DISMISSALS = 500;
const PROFILE_DEBOUNCE_MS = 250;

export function App() {
  const [docs, setDocs] = useState([]);
  const [doc, setDoc] = useState(/** @type {db.StoredDocument | null} */ (null));
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [dismissals, setDismissals] = useState([]);
  const [revision, setRevision] = useState(0);
  const [settingsRevision, setSettingsRevision] = useState(0);
  const [envelope, setEnvelope] = useState(/** @type {import('../analysis/types.js').Envelope | null} */ (null));
  const [hidden, setHidden] = useState(() => new Set());
  const [activeId, setActiveId] = useState(/** @type {string | null} */ (null));
  const [checkStatus, setCheckStatus] = useState('idle');
  const [saveStatus, setSaveStatus] = useState('saved');
  const [profile, setProfile] = useState(null);
  const [persisted, setPersisted] = useState(/** @type {boolean | null} */ (null));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recovery, setRecovery] = useState([]);
  const [announcement, setAnnouncement] = useState('');
  const [storageError, setStorageError] = useState('');
  const [assistOpen, setAssistOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > 900);
  const [focusMode, setFocusMode] = useState(false);
  const [popover, setPopover] = useState(/** @type {{ id: string, el: Element | null } | null} */ (null));
  const [storageNoticeHidden, setStorageNoticeHidden] = useState(false);
  const [revealTick, setRevealTick] = useState(0);
  // Bumped on every (re)load so the editor is rebuilt from the stored content,
  // even when the same document is reloaded.
  const [loadKey, setLoadKey] = useState(0);
  const [ai, setAi] = useState(connections.EMPTY);
  const [assistTab, setAssistTab] = useState('suggestions');
  const [selectionWords, setSelectionWords] = useState(0);
  // A document that came from the browser extension, which can send its text back.
  const [extensionLink, setExtensionLink] = useState(/** @type {null | { docId: string, from: string }} */ (null));

  // Mutable mirrors for callbacks that outlive a render.
  const docRef = useRef(doc);
  const prefsRef = useRef(prefs);
  const dismissalsRef = useRef(dismissals);
  const revisionRef = useRef(0);
  const settingsRevRef = useRef(0);
  const saveIdRef = useRef('');
  const saveTimer = useRef(0);
  const lastRecoveryAt = useRef(0);
  const rangesRef = useRef(/** @type {Map<string, { from: number, to: number }>} */ (new Map()));
  const saveChain = useRef(Promise.resolve());
  const persistAsked = useRef(false);
  const channelRef = useRef(/** @type {BroadcastChannel | null} */ (null));
  const profileTimer = useRef(0);
  // AI findings, re-anchored against every new snapshot (ai/reanchor.js).
  const returnTextRef = useRef('');
  const aiIssuesRef = useRef(/** @type {import('../analysis/types.js').Issue[]} */ ([]));
  const schedulerRef = useRef(/** @type {ReturnType<typeof createScheduler> | null} */ (null));
  const pendingImport = useRef(/** @type {{ html: string, parseOptions?: object } | null} */ (null));
  const editorRef = useRef(/** @type {import('@tiptap/core').Editor | null} */ (null));
  const revealRef = useRef(/** @type {string | null} */ (null));
  docRef.current = doc;
  prefsRef.current = prefs;
  dismissalsRef.current = dismissals;

  // ---- documents and preferences -------------------------------------------------

  const refreshDocs = useCallback(async () => setDocs(await db.listDocuments()), []);

  useEffect(() => {
    (async () => {
      try {
        const stored = await db.getPref('settings', DEFAULT_PREFS);
        setPrefs({ ...DEFAULT_PREFS, ...stored });
        setDismissals(await db.getPref('dismissals', []));
        setAi(connections.normalize(await db.getPref('aiConnections', null)));
        let list = await db.listDocuments();
        const handoff = takeHandoff();
        if (handoff) {
          // Text pasted on a landing page becomes its own document.
          const created = await importText(handoff.text, titleFrom(handoff.text));
          if (handoff.intent === 'paraphrase') {
            setAssistTab('ai');
            setAssistOpen(true);
          }
          setPersisted(navigator.storage?.persisted ? await navigator.storage.persisted() : false);
          if (created) return;
        }
        if (!list.length) {
          // First visit: a short guided document with mistakes to try.
          pendingImport.current = { html: WELCOME_HTML };
          await db.createDocument({ title: WELCOME_TITLE });
          list = await db.listDocuments();
          count('document.created');
        }
        setDocs(list);
        const lastId = await db.getPref('lastDocumentId', null);
        await openDocument(list.find((d) => d.id === lastId)?.id ?? list[0].id);
        setPersisted(navigator.storage?.persisted ? await navigator.storage.persisted() : false);
      } catch (err) {
        setStorageError(`Local storage is unavailable (${err?.message ?? err}). You can still write, but nothing will be saved: export your work.`);
        setDoc({ id: 'unsaved', title: 'Untitled', content: { type: 'doc', content: [{ type: 'paragraph' }] }, saveId: '', createdAt: Date.now(), updatedAt: Date.now(), goals: {} });
      } finally {
        setPrefsLoaded(true);
        count('app.loaded');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openDocument(id) {
    await flushSave();
    const d = await db.getDocument(id);
    if (!d) return;
    saveIdRef.current = d.saveId;
    lastRecoveryAt.current = Date.now();
    revisionRef.current = 0;
    setRevision(0);
    setEnvelope(null);
    setHidden(new Set());
    setActiveId(null);
    setPopover(null);
    rangesRef.current = new Map();
    aiIssuesRef.current = [];
    aiReview.reset();
    setSaveStatus('saved');
    setDoc(d);
    setLoadKey((k) => k + 1);
    setRecovery(await db.listRecovery(id));
    db.setPref('lastDocumentId', id).catch(() => {});
  }

  // Another tab saved the open document.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return undefined;
    const ch = new BroadcastChannel('online-writer');
    channelRef.current = ch;
    ch.onmessage = (e) => {
      const msg = e.data;
      if (msg?.type !== 'saved' && msg?.type !== 'deleted') return;
      refreshDocs();
      if (msg.id !== docRef.current?.id) return;
      if (msg.type === 'deleted') setSaveStatus('deleted');
      else if (msg.saveId !== saveIdRef.current) setSaveStatus((s) => (s === 'saved' ? 'conflict-clean' : 'conflict'));
    };
    return () => {
      ch.close();
      channelRef.current = null;
    };
  }, [refreshDocs]);

  // A clean document is simply reloaded when another tab changes it.
  useEffect(() => {
    if (saveStatus === 'conflict-clean' && doc) openDocument(doc.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveStatus]);

  /** Saves run one at a time, so each one expects the saveId the previous one wrote. */
  function save(force = false) {
    const next = saveChain.current.then(() => saveNow(force));
    saveChain.current = next;
    return next;
  }

  async function saveNow(force) {
    const ed = editorRef.current;
    const d = docRef.current;
    if (!ed || !d || d.id === 'unsaved') return;
    clearTimeout(saveTimer.current);
    saveTimer.current = 0;
    setSaveStatus('saving');
    try {
      const content = ed.getJSON();
      const saved = await db.saveDocument({ ...d, content }, saveIdRef.current, { force });
      // Keep edits made while the write ran (a title keystroke, say); only take the new saveId.
      if (docRef.current?.id === saved.id) {
        saveIdRef.current = saved.saveId;
        docRef.current = { ...docRef.current, saveId: saved.saveId, updatedAt: saved.updatedAt };
        setDoc((cur) => (cur?.id === saved.id ? { ...cur, saveId: saved.saveId, updatedAt: saved.updatedAt } : cur));
      }
      setSaveStatus(saveTimer.current ? 'unsaved' : 'saved');
      channelRef.current?.postMessage({ type: 'saved', id: saved.id, saveId: saved.saveId });
      refreshDocs();
      if (Date.now() - lastRecoveryAt.current > RECOVERY_EVERY_MS) {
        lastRecoveryAt.current = Date.now();
        await db.addRecovery(saved.id, saved.title, content);
        setRecovery(await db.listRecovery(saved.id));
      }
      // Ask once per session: browsers that refuse keep refusing, and some prompt.
      // Not awaited: Firefox shows a permission prompt, and saving must not wait
      // for the user to answer it.
      if (!persistAsked.current && persisted !== true) {
        persistAsked.current = true;
        db.requestPersistence().then(
          (granted) => {
            setPersisted(granted);
            count(granted ? 'storage.persist_granted' : 'storage.persist_denied');
          },
          () => {},
        );
      }
    } catch (err) {
      if (err instanceof db.SaveConflictError) setSaveStatus('conflict');
      else if (err instanceof db.DocumentMissingError) setSaveStatus('deleted');
      else {
        setSaveStatus('error');
        count('storage.save_failed');
      }
    }
  }

  function scheduleSave() {
    setSaveStatus((s) => (s === 'conflict' || s === 'deleted' ? s : 'unsaved'));
    clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => save(), SAVE_DEBOUNCE_MS);
  }

  async function flushSave() {
    if (saveTimer.current) await save();
    else await saveChain.current;
  }

  /** Drop a pending save without writing it. */
  function cancelPendingSave() {
    clearTimeout(saveTimer.current);
    saveTimer.current = 0;
  }

  function updateDoc(patch) {
    setDoc((d) => (d ? { ...d, ...patch } : d));
    docRef.current = { ...docRef.current, ...patch };
    scheduleSave();
  }

  // ---- checking ---------------------------------------------------------------------

  const currentRequest = useCallback(() => {
    const ed = editorRef.current;
    const d = docRef.current;
    if (!ed || !d) return null;
    const p = prefsRef.current;
    const { snapshot, positions } = snapshotFromDoc(ed.state.doc, {
      documentId: d.id,
      revision: revisionRef.current,
      settingsRevision: settingsRevRef.current,
    });
    const settings = {
      dialect: p.dialect,
      dictionary: p.dictionary,
      disabledRules: p.disabledRules,
      longSentenceWords: p.longSentenceWords,
      goals: d.goals ?? {},
    };
    return { snapshot, settings, suppressions: { occurrences: dismissalsRef.current }, positions };
  }, []);

  useEffect(() => {
    const s = createScheduler({
      createWorker: () => new Worker(new URL('../workers/analysis.worker.js', import.meta.url), { type: 'module' }),
      getRequest: currentRequest,
      isCurrent: (t) => t.documentId === docRef.current?.id && t.revision === revisionRef.current && t.settingsRevision === settingsRevRef.current,
      isComposing: () => editorRef.current?.view.composing ?? false,
      onResult: (result, positions, _ms, snapshot) => {
        // Dismissals and dictionary words added while this check ran must still apply.
        const p = prefsRef.current;
        const suppress = (issues) =>
          applySuppressions(snapshot, issues, {
            dictionary: p.dictionary,
            disabledRules: p.disabledRules,
            occurrences: dismissalsRef.current,
          });
        aiIssuesRef.current = reanchor(aiIssuesRef.current, snapshot, positions, rangesRef.current);
        // Local findings come first, so a duplicate AI finding collapses into them.
        const { findings } = mergeIssues(snapshot, [...suppress(result.findings), ...suppress(aiIssuesRef.current)]);
        rangesRef.current = issueRanges(findings, positions);
        const env = { ...result, findings };
        setEnvelope(env);
        setHidden(new Set());
        count('check.completed');
        const errors = env.findings.filter((f) => f.classification === 'likely-error').length;
        setAnnouncement(`${errors} likely error${errors === 1 ? '' : 's'}, ${env.findings.length - errors} suggestion${env.findings.length - errors === 1 ? '' : 's'}`);
      },
      onStatus: (st) => {
        setCheckStatus(st);
        if (st === 'failed') count('check.failed');
        if (st === 'unavailable') count('worker.crashed');
      },
    });
    schedulerRef.current = s;
    return () => s.destroy();
  }, [currentRequest]);

  useEffect(() => {
    if (!prefsLoaded) return;
    if (prefs.paused) schedulerRef.current?.pause();
    else schedulerRef.current?.resume();
  }, [prefs.paused, prefsLoaded]);

  function updateProfile() {
    const req = currentRequest();
    if (!req) return;
    setProfile(documentProfile(req.snapshot, req.settings, { protectedSpans: false }));
  }

  /** Stats walk the whole document, so they wait for a pause in typing. */
  function scheduleProfile() {
    clearTimeout(profileTimer.current);
    profileTimer.current = window.setTimeout(updateProfile, PROFILE_DEBOUNCE_MS);
  }

  useEffect(() => () => clearTimeout(profileTimer.current), []);

  // ---- editor -----------------------------------------------------------------------

  // Built once per load; the editor only reads them when it is created.
  const extensions = useMemo(
    () =>
      editorExtensions({
        onIssueClick: (id) => {
          setActiveId(id);
          setPopover({ id, el: null });
        },
      }),
    [],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const content = useMemo(() => (doc ? sanitizeDocJson(doc.content) : ''), [doc?.id, loadKey]);

  const editor = useEditor(
    {
      extensions,
      content,
      injectCSS: false,
      immediatelyRender: true,
      // Read-only until the document has loaded: anything typed earlier would be
      // replaced when it arrives.
      editable: Boolean(doc),
      shouldRerenderOnTransaction: false,
      editorProps: { attributes: { class: 'prose', 'aria-label': 'Document', spellcheck: 'false', id: 'document' } },
      onCreate: ({ editor: ed }) => {
        editorRef.current = ed;
        ed.view.dispatch(ed.state.tr.setMeta(ENSURE_BLOCK_IDS, true).setMeta('addToHistory', false));
        if (pendingImport.current) {
          const { html, parseOptions } = pendingImport.current;
          ed.commands.setContent(html, { parseOptions });
          pendingImport.current = null;
        }
        updateProfile();
        schedulerRef.current?.schedule(true);
      },
      onUpdate: ({ transaction }) => {
        setPopover(null);
        rangesRef.current = mapIssueRanges(rangesRef.current, transaction.mapping);
        revisionRef.current += 1;
        setRevision(revisionRef.current);
        scheduleSave();
        scheduleProfile();
        schedulerRef.current?.schedule();
      },
    },
    [doc?.id, loadKey],
  );
  editorRef.current = editor;

  const findings = useMemo(() => (envelope?.findings ?? []).filter((f) => !hidden.has(f.id)), [envelope, hidden]);

  // Keep decorations in sync with findings and the active issue.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    // Ranges are mapped through every edit, so they stay right after the check's snapshot ages.
    const decorations = issueDecorations(findings, rangesRef.current, activeId);
    editor.view.dispatch(editor.state.tr.setMeta(issueKey, { decorations }).setMeta('addToHistory', false));
    // Decoration elements are re-rendered above, so look them up afterwards.
    const elFor = (id) => editor.view.dom.querySelector(`[data-issue-id="${CSS.escape(id)}"]`);
    if (revealRef.current) {
      const el = elFor(revealRef.current);
      revealRef.current = null;
      if (el) {
        const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        el.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
        el.classList.remove('issue--flash');
        void el.getBoundingClientRect();
        el.classList.add('issue--flash');
      }
    }
    setPopover((p) => (p && (!p.el || !p.el.isConnected) ? { ...p, el: elFor(p.id) } : p));
  }, [editor, findings, activeId, revealTick]);

  const isStale = useCallback(
    (issue) => issue.sourceRevision !== revisionRef.current || issue.settingsRevision !== settingsRevRef.current,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revision, settingsRevision],
  );

  /**
   * Make an issue active and move the document view to its text. The scroll
   * happens after decorations re-render (see the effect above), so it works
   * even while a newer check is pending.
   */
  function selectIssue(id) {
    revealRef.current = id;
    setActiveId(id);
    setRevealTick((n) => n + 1); // scroll again even when the issue is already active
    const range = rangesRef.current.get(id);
    if (editor && range) editor.commands.setTextSelection(range);
  }

  function moveIssue(delta) {
    if (!findings.length) return;
    const i = findings.findIndex((f) => f.id === activeId);
    const next = findings[(i + delta + findings.length) % findings.length];
    selectIssue(next.id);
  }

  function accept(issue, text) {
    const d = docRef.current;
    const res = applyReplacement(editor, { documentId: d.id, revision: revisionRef.current, settingsRevision: settingsRevRef.current }, issue, text);
    if (res.ok) {
      count(`suggestion.accepted.${issue.category}`);
      // Otherwise the next check finds its quote again, elsewhere or in the replacement.
      if (issue.origin.kind === 'ai') aiIssuesRef.current = aiIssuesRef.current.filter((i) => i.id !== issue.id);
      hide(issue.id);
      setPopover(null);
      setAnnouncement('Change applied. Undo is available.');
      // Move to the next issue so keyboard users can keep going.
      const rest = findings.filter((f) => f.id !== issue.id);
      setActiveId(rest[0]?.id ?? null);
      editor.commands.focus();
    } else {
      setAnnouncement('The text changed. Updating suggestions…');
      schedulerRef.current?.schedule(true);
    }
  }

  function hide(id) {
    setHidden((h) => new Set(h).add(id));
  }

  // Persist before updating the UI, so a dismissal survives an immediate reload.
  async function dismiss(issue, { reported = false } = {}) {
    const req = currentRequest();
    const record = req && issue.sourceRevision === revisionRef.current ? dismissalFor(req.snapshot, issue) : null;
    if (record) {
      const next = [...dismissalsRef.current, record].slice(-MAX_DISMISSALS);
      dismissalsRef.current = next;
      setDismissals(next);
      await db.setPref('dismissals', next).catch(() => {});
    }
    if (issue.origin.kind === 'ai') aiIssuesRef.current = aiIssuesRef.current.filter((i) => i.id !== issue.id);
    count(`suggestion.${reported ? 'reported' : 'dismissed'}.${issue.category}`);
    hide(issue.id);
    setPopover(null);
    if (reported) setAnnouncement('Thanks. The report says only which kind of check was wrong.');
  }

  function changePrefs(patch, { recheck = true } = {}) {
    const next = { ...prefsRef.current, ...patch };
    prefsRef.current = next;
    setPrefs(next);
    if (recheck) {
      settingsRevRef.current += 1;
      setSettingsRevision(settingsRevRef.current);
      schedulerRef.current?.schedule(true);
    }
    return db.setPref('settings', next).catch(() => {});
  }

  async function addWord(word) {
    if (prefsRef.current.dictionary.includes(word)) return;
    await changePrefs({ dictionary: [...prefsRef.current.dictionary, word].sort((a, b) => a.localeCompare(b)) });
    count('dictionary.word_added');
    setHidden((h) => new Set([...h, ...findings.filter((f) => f.category === 'spelling' && f.anchor?.expectedText === word).map((f) => f.id)]));
  }

  async function disableRule(issue) {
    await changePrefs({ disabledRules: [...new Set([...prefsRef.current.disabledRules, issue.origin.ruleId])] });
    count('rule.disabled');
    setHidden((h) => new Set([...h, ...findings.filter((f) => f.origin.ruleId === issue.origin.ruleId).map((f) => f.id)]));
  }

  // ---- AI connections ---------------------------------------------------------------

  function changeAi(next) {
    setAi(next);
    db.setPref('aiConnections', next).catch(() => setAnnouncement('Could not save the AI connection in this browser.'));
  }

  const activeAi = connections.activeConnection(ai);

  /**
   * New AI review findings replace earlier ones from the same action. They
   * join the panel now, anchored against the current text, and every later
   * check re-anchors them.
   */
  function addAiFindings(issues, action) {
    const req = currentRequest();
    if (!req) return;
    const fresh = reanchor(issues, req.snapshot, req.positions, null);
    aiIssuesRef.current = [...aiIssuesRef.current.filter((i) => i.origin.ruleId !== `ai-${action}`), ...fresh];
    const p = prefsRef.current;
    const ai = applySuppressions(req.snapshot, aiIssuesRef.current, {
      dictionary: p.dictionary,
      disabledRules: p.disabledRules,
      occurrences: dismissalsRef.current,
    });
    const ranges = new Map(rangesRef.current);
    for (const [id, r] of issueRanges(ai, req.positions)) ranges.set(id, r);
    rangesRef.current = ranges;
    setEnvelope((env) =>
      env ? { ...env, findings: mergeIssues(req.snapshot, [...env.findings.filter((f) => f.origin.kind !== 'ai'), ...ai]).findings } : env,
    );
    schedulerRef.current?.schedule(true);
  }

  const aiReview = useAiReview({
    editorRef,
    currentRequest,
    revisionRef,
    settingsRevRef,
    docRef,
    connection: activeAi,
    onFindings: addAiFindings,
    onApplied: taskCompleted,
    announce: setAnnouncement,
  });

  // ---- browser extension ---------------------------------------------------------
  // The extension's content script and this page talk with window messages on this
  // origin only. It delivers selected text; "Send back" returns the edited text.

  useEffect(() => {
    if (!prefsLoaded) return undefined;
    const onMessage = async (e) => {
      if (e.source !== window || e.origin !== window.location.origin) return;
      const m = e.data;
      if (m?.source !== 'ow-extension') return;
      if (m.type === 'hello') window.postMessage({ source: 'ow-app', type: 'ready' }, window.location.origin);
      if (m.type === 'import' && typeof m.text === 'string' && m.text.trim()) {
        const from = typeof m.from === 'string' ? m.from.slice(0, 100) : 'another page';
        const created = await importText(m.text, `From ${from}`, { lines: true });
        if (created && m.returnable) setExtensionLink({ docId: created.id, from });
        count('extension.imported');
      } else if (m.type === 'returned') {
        if (m.ok) {
          setAnnouncement(`Sent back to ${m.from ?? 'the page'}.`);
          count('extension.returned');
          return;
        }
        // The selection there changed or the page closed: never guess where the text goes.
        const copied = await navigator.clipboard.writeText(returnTextRef.current).then(() => true, () => false);
        setAnnouncement(
          m.reason === 'changed'
            ? `The text on ${m.from ?? 'the page'} changed, so nothing was replaced.${copied ? ' Your text is on the clipboard.' : ''}`
            : `Could not reach ${m.from ?? 'the page'}; it may have closed.${copied ? ' Your text is on the clipboard.' : ''}`,
        );
      }
    };
    window.addEventListener('message', onMessage);
    window.postMessage({ source: 'ow-app', type: 'ready' }, window.location.origin);
    return () => window.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefsLoaded]);

  function sendBack() {
    const req = currentRequest();
    if (!req || !extensionLink) return;
    returnTextRef.current = linesText(req.snapshot);
    window.postMessage({ source: 'ow-app', type: 'return', text: returnTextRef.current }, window.location.origin);
    taskCompleted();
  }

  // How much is selected, for the AI panel's scope choice.
  useEffect(() => {
    if (!editor) return undefined;
    const onSelection = () => {
      const { from, to } = editor.state.selection;
      setSelectionWords(from === to ? 0 : countWords(editor.state.doc.textBetween(from, to, ' ')));
    };
    editor.on('selectionUpdate', onSelection);
    editor.on('update', onSelection);
    return () => {
      editor.off('selectionUpdate', onSelection);
      editor.off('update', onSelection);
    };
  }, [editor]);

  // ---- export and import ---------------------------------------------------------

  async function exportAs(kind) {
    const req = currentRequest();
    if (!req) return;
    const name = safeFilename(docRef.current.title);
    if (kind === 'copy') {
      await navigator.clipboard.writeText(toPlainText(req.snapshot));
      setAnnouncement('Copied to the clipboard.');
    } else if (kind === 'txt') {
      download(new Blob([toPlainText(req.snapshot)], { type: 'text/plain;charset=utf-8' }), `${name}.txt`);
    } else if (kind === 'md') {
      download(new Blob([toMarkdown(req.snapshot)], { type: 'text/markdown;charset=utf-8' }), `${name}.md`);
    } else {
      download(await toDocx(req.snapshot), `${name}.docx`);
    }
    count(`export.${kind}`);
    taskCompleted();
  }

  async function importDocx(file) {
    try {
      const { html } = await docxToHtml(await file.arrayBuffer());
      pendingImport.current = { html: sanitizePastedHtml(html) };
      const created = await db.createDocument({ title: file.name.replace(/\.docx$/iu, '') });
      count('import.docx');
      await refreshDocs();
      await openDocument(created.id);
    } catch (err) {
      setAnnouncement(`Could not import that file: ${err?.message ?? err}`);
    }
  }

  /** Make a new document from plain text and open it. */
  async function importText(text, title, { lines = false } = {}) {
    // Lines from a text field keep their spacing (indents, aligned columns).
    pendingImport.current = { html: textToHtml(text, { lines }), parseOptions: lines ? { preserveWhitespace: 'full' } : undefined };
    const created = await db.createDocument({ title });
    count('document.created');
    await refreshDocs();
    await openDocument(created.id);
    return created;
  }

  /** First and repeat completed tasks (export, or applying an AI result). The flag stays in this browser; no identifier is sent. */
  function taskCompleted() {
    let first = false;
    try {
      first = !localStorage.getItem('ow:task-done');
      localStorage.setItem('ow:task-done', '1');
    } catch {
      // Storage blocked: count as a repeat.
    }
    count(first ? 'task.completed.first' : 'task.completed.repeat');
  }

  async function newDocument() {
    const created = await db.createDocument();
    count('document.created');
    await refreshDocs();
    await openDocument(created.id);
  }

  async function removeDocument(id) {
    // A pending save of this document would write it back after the delete.
    if (id === docRef.current?.id) {
      cancelPendingSave();
      await saveChain.current;
    }
    await db.deleteDocument(id);
    channelRef.current?.postMessage({ type: 'deleted', id });
    count('document.deleted');
    const list = await db.listDocuments();
    if (!list.length) return newDocument();
    setDocs(list);
    if (id === docRef.current?.id) await openDocument(list[0].id);
  }

  async function restore(key) {
    const r = recovery.find((x) => x.key === key);
    if (!r || !editor) return;
    editor.commands.setContent(sanitizeDocJson(r.content));
    count('document.recovered');
  }

  async function resolveConflict(keepMine) {
    if (keepMine) await save(true);
    else if (doc) {
      cancelPendingSave();
      await openDocument(doc.id);
    }
  }

  /** The open document was deleted in another tab: keep it here, or let it go. */
  async function resolveDeleted(keep) {
    if (keep) {
      await save(true);
      return;
    }
    cancelPendingSave();
    const list = await db.listDocuments();
    setDocs(list);
    if (list.length) await openDocument(list[0].id);
    else await newDocument();
  }

  // ---- keyboard ----------------------------------------------------------------------

  useEffect(() => {
    const onKey = (e) => {
      if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        moveIssue(e.key === 'ArrowDown' ? 1 : -1);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        save();
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setFocusMode((f) => !f);
      }
      if (e.key === 'Escape' && !popover && focusMode) setFocusMode(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    const onUnload = (e) => {
      if (saveTimer.current) {
        save();
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  });

  // ---- render ------------------------------------------------------------------------

  const summary =
    checkStatus === 'unavailable' ? 'Checking is unavailable. Your writing is safe and you can keep editing.'
    : checkStatus === 'paused' ? 'Checking is paused. Turn it back on in Settings.'
    : !envelope ? 'Checking your writing…'
    : envelope.coverage.partial ? `${envelope.summary} Some checks failed, so this is partial.`
    : findings.length === 0 && checkStatus === 'current' ? 'No suggestions right now. That doesn’t guarantee the text is error-free.'
    : envelope.summary;

  const c = profile?.counts;
  const popoverIssue = popover && findings.find((f) => f.id === popover.id);
  const issueHandlers = { onAccept: accept, onDismiss: (issue) => dismiss(issue), onReport: (issue) => dismiss(issue, { reported: true }), onAddWord: addWord, onDisableRule: disableRule, isStale };

  return (
    <div className={`app${focusMode ? ' focus-mode' : ''}`}>
      {/* Targets the editable document itself, so following it puts the cursor there. */}
      <a href="#document" className="skip-link">Skip to editor</a>
      <Topbar
        title={doc?.title ?? ''}
        onTitle={(title) => updateDoc({ title })}
        saveStatus={saveStatus}
        goals={doc?.goals ?? {}}
        onGoals={(g) => {
          updateDoc({ goals: { ...(docRef.current?.goals ?? {}), ...g } });
          updateProfile();
          // Formality changes which checks apply, so results from before are stale.
          if ('formality' in g) {
            settingsRevRef.current += 1;
            setSettingsRevision(settingsRevRef.current);
            schedulerRef.current?.schedule(true);
          }
        }}
        onExport={exportAs}
        onSettings={() => setSettingsOpen(true)}
        drawerOpen={drawerOpen}
        onToggleDrawer={() => setDrawerOpen((o) => !o)}
        focusMode={focusMode}
        onToggleFocus={() => setFocusMode((f) => !f)}
      />
      <FormatBar editor={editor} />
      <Sidebar
        open={drawerOpen && !focusMode}
        docs={docs}
        currentId={doc?.id ?? null}
        onOpen={(id) => {
          openDocument(id);
          if (window.innerWidth <= 900) setDrawerOpen(false);
        }}
        onNew={newDocument}
        onDelete={removeDocument}
        onImport={importDocx}
        recovery={recovery}
        onRestore={restore}
      />
      <main className="desk" id="editor">
        {storageError && <p className="banner banner--error" role="alert">{storageError}</p>}
        {saveStatus === 'conflict' && (
          <div className="banner banner--warning" role="alert">
            This document was changed in another tab.
            <button type="button" className="btn btn--sm btn--secondary" onClick={() => resolveConflict(false)}>Load that version</button>
            <button type="button" className="btn btn--sm" onClick={() => resolveConflict(true)}>Keep this version</button>
          </div>
        )}
        {saveStatus === 'deleted' && (
          <div className="banner banner--warning" role="alert">
            This document was deleted in another tab.
            <button type="button" className="btn btn--sm btn--secondary" onClick={() => resolveDeleted(false)}>Close it</button>
            <button type="button" className="btn btn--sm" onClick={() => resolveDeleted(true)}>Keep it</button>
          </div>
        )}
        {extensionLink && extensionLink.docId === doc?.id && (
          <div className="banner banner--info" role="region" aria-label="Browser extension">
            From {extensionLink.from}. When you are done, send the text back to replace your selection there.
            <button type="button" className="btn btn--sm" onClick={sendBack}>Send back</button>
          </div>
        )}
        {saveStatus === 'error' && (
          <div className="banner banner--error" role="alert">
            Your latest changes are not saved.
            <button type="button" className="btn btn--sm" onClick={() => save()}>Try again</button>
            or export your work.
          </div>
        )}
        {persisted === false && !storageNoticeHidden && (
          <div className="banner banner--info">
            Drafts are stored only in this browser, which may clear them. Export anything you need to keep.
            <button type="button" className="btn btn--sm btn--ghost banner__close" onClick={() => setStorageNoticeHidden(true)}>Got it</button>
          </div>
        )}
        <article className="sheet">
          <EditorContent editor={editor} />
        </article>
      </main>
      <AssistPanel
        findings={findings}
        activeId={activeId}
        summary={summary}
        checkStatus={checkStatus}
        profile={profile}
        open={assistOpen}
        onClose={() => setAssistOpen(false)}
        onSelect={selectIssue}
        onRetry={() => schedulerRef.current?.retry()}
        onReturnFocus={() => editor?.commands.focus()}
        tab={assistTab}
        onTab={setAssistTab}
        aiBusy={aiReview.state.status === 'running' || aiReview.state.status === 'validating-output'}
        aiPanel={
          <AiPanel
            ai={aiReview}
            connection={activeAi}
            selectionWords={selectionWords}
            revision={revision}
            goals={doc?.goals ?? {}}
            onOpenSettings={() => setSettingsOpen(true)}
            onShowSuggestions={() => setAssistTab('suggestions')}
          />
        }
        {...issueHandlers}
      />
      <div className={`scrim${assistOpen || (drawerOpen && window.innerWidth <= 900) ? ' scrim--on' : ''}`} onClick={() => (setAssistOpen(false), window.innerWidth <= 900 && setDrawerOpen(false))} />
      <footer className="statusbar" aria-label="Status">
        <span>{c ? `${c.words.toLocaleString()} words · ${Math.max(1, Math.round(c.readingMinutes))} min read` : ''}</span>
        <span className={`status__check status__check--${checkStatus}`}>{CHECK_STATUS_LABELS[checkStatus]}</span>
        <span className="statusbar__spacer" />
        <span className="statusbar__hint">Alt+↓ next suggestion · {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+'}Shift+F focus</span>
        <button
          type="button"
          className={`btn btn--sm btn--ghost statusbar__ai${activeAi ? '' : ' statusbar__ai--off'}`}
          title={activeAi ? `AI actions use ${activeAi.providerLabel}: ${activeAi.model}` : 'Connect an AI provider in Settings'}
          onClick={() => setSettingsOpen(true)}
        >
          AI: {activeAi ? activeAi.label : 'not connected'}
        </button>
        <button type="button" className="btn btn--sm btn--secondary statusbar__review" onClick={() => setAssistOpen(true)}>
          <IconReview /> Review ({findings.length})
        </button>
      </footer>
      {popoverIssue && popover.el && (
        <IssuePopover issue={popoverIssue} anchorEl={popover.el} onClose={() => setPopover(null)} {...issueHandlers} />
      )}
      <div className="visually-hidden" role="status" aria-live="polite">{announcement}</div>
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        prefs={prefs}
        persisted={persisted}
        onChange={(patch) => changePrefs(patch, { recheck: !('paused' in patch) })}
        onRemoveWord={(w) => changePrefs({ dictionary: prefsRef.current.dictionary.filter((x) => x !== w) })}
        onEnableRule={(id) => changePrefs({ disabledRules: prefsRef.current.disabledRules.filter((x) => x !== id) })}
        ai={ai}
        onAiChange={changeAi}
        onAiConnected={() => count('ai.connection.added')}
      />
    </div>
  );
}
