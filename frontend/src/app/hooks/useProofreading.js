// Local checking: the worker scheduler, the current envelope of findings,
// issue navigation, accepting and dismissing, and the AI findings that ride
// along and are re-anchored on every check. Split out of App.jsx (plan §0.2).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { issueRanges, mapIssueRanges } from '../../editor/extensions.js';
import { snapshotFromDoc } from '../../editor/snapshot-from-editor.js';
import { applyReplacement } from '../../editor/apply-edit.js';
import { createScheduler } from '../../proofreading/scheduler.js';
import { dismissalFor, applySuppressions } from '../../analysis/issues/dismissals.js';
import { mergeIssues } from '../../analysis/issues/merge.js';
import { reanchor } from '../../ai/reanchor.js';
import { documentProfile } from '../../analysis/profile.js';
import { count } from '../telemetry.js';

const PROFILE_DEBOUNCE_MS = 250;

/**
 * @param {{
 *   editorRef: React.MutableRefObject<import('@tiptap/core').Editor | null>,
 *   docRef: React.MutableRefObject<any>,
 *   prefsRef: React.MutableRefObject<any>,
 *   dismissalsRef: React.MutableRefObject<any[]>,
 *   prefs: any, prefsLoaded: boolean,
 *   savePrefs: (next: any) => Promise<void>,
 *   addDismissal: (record: any) => Promise<void>,
 *   announce: (text: string) => void,
 * }} deps
 */
export function useProofreading({ editorRef, docRef, prefsRef, dismissalsRef, prefs, prefsLoaded, savePrefs, addDismissal, announce }) {
  const [revision, setRevision] = useState(0);
  const [settingsRevision, setSettingsRevision] = useState(0);
  const [envelope, setEnvelope] = useState(/** @type {import('../../analysis/types.js').Envelope | null} */ (null));
  const [hidden, setHidden] = useState(() => new Set());
  const [activeId, setActiveId] = useState(/** @type {string | null} */ (null));
  const [checkStatus, setCheckStatus] = useState('idle');
  const [profile, setProfile] = useState(null);
  const [popover, setPopover] = useState(/** @type {{ id: string, el: Element | null } | null} */ (null));
  const [revealTick, setRevealTick] = useState(0);

  const revisionRef = useRef(0);
  const settingsRevRef = useRef(0);
  const rangesRef = useRef(/** @type {Map<string, { from: number, to: number }>} */ (new Map()));
  const profileTimer = useRef(0);
  // AI findings, re-anchored against every new snapshot (ai/reanchor.js).
  const aiIssuesRef = useRef(/** @type {import('../../analysis/types.js').Issue[]} */ ([]));
  const schedulerRef = useRef(/** @type {ReturnType<typeof createScheduler> | null} */ (null));
  const revealRef = useRef(/** @type {string | null} */ (null));

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const s = createScheduler({
      createWorker: () => new Worker(new URL('../../workers/analysis.worker.js', import.meta.url), { type: 'module' }),
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
        announce(`${errors} likely error${errors === 1 ? '' : 's'}, ${env.findings.length - errors} suggestion${env.findings.length - errors === 1 ? '' : 's'}`);
      },
      onStatus: (st) => {
        setCheckStatus(st);
        if (st === 'failed') count('check.failed');
        if (st === 'unavailable') count('worker.crashed');
      },
    });
    schedulerRef.current = s;
    return () => s.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRequest]);

  useEffect(() => {
    if (!prefsLoaded) return;
    if (prefs.paused) schedulerRef.current?.pause();
    else schedulerRef.current?.resume();
  }, [prefs.paused, prefsLoaded]);

  function updateProfile() {
    const req = currentRequest();
    if (!req) return;
    const outline = req.snapshot.blocks
      .filter((b) => b.type === 'heading' && b.text.trim())
      .map((b) => ({ id: b.id, level: b.level ?? 1, text: b.text, pos: req.positions.get(b.id) ?? 0 }));
    setProfile({ ...documentProfile(req.snapshot, req.settings, { protectedSpans: false }), outline });
  }

  /** Stats walk the whole document, so they wait for a pause in typing. */
  function scheduleProfile() {
    clearTimeout(profileTimer.current);
    profileTimer.current = window.setTimeout(updateProfile, PROFILE_DEBOUNCE_MS);
  }

  useEffect(() => () => clearTimeout(profileTimer.current), []);

  /** Forget everything about the previous document; called while a document opens. */
  function reset() {
    revisionRef.current = 0;
    setRevision(0);
    setEnvelope(null);
    setHidden(new Set());
    setActiveId(null);
    setPopover(null);
    rangesRef.current = new Map();
    aiIssuesRef.current = [];
  }

  /** Settings that change which checks apply make earlier results stale. */
  function bumpSettings() {
    settingsRevRef.current += 1;
    setSettingsRevision(settingsRevRef.current);
    schedulerRef.current?.schedule(true);
  }

  /** The editor changed: map ranges, bump the revision, and queue a check. */
  function onEditorUpdate(transaction) {
    setPopover(null);
    rangesRef.current = mapIssueRanges(rangesRef.current, transaction.mapping);
    revisionRef.current += 1;
    setRevision(revisionRef.current);
    scheduleProfile();
    schedulerRef.current?.schedule();
  }

  const findings = useMemo(() => (envelope?.findings ?? []).filter((f) => !hidden.has(f.id)), [envelope, hidden]);

  const isStale = useCallback(
    (issue) => issue.sourceRevision !== revisionRef.current || issue.settingsRevision !== settingsRevRef.current,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revision, settingsRevision],
  );

  /**
   * Make an issue active and move the document view to its text. The scroll
   * happens after decorations re-render (useDocumentEditor), so it works
   * even while a newer check is pending.
   */
  function selectIssue(id) {
    revealRef.current = id;
    setActiveId(id);
    setRevealTick((n) => n + 1); // scroll again even when the issue is already active
    const range = rangesRef.current.get(id);
    const editor = editorRef.current;
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
    const editor = editorRef.current;
    const res = applyReplacement(editor, { documentId: d.id, revision: revisionRef.current, settingsRevision: settingsRevRef.current }, issue, text);
    if (res.ok) {
      count(`suggestion.accepted.${issue.category}`);
      // Otherwise the next check finds its quote again, elsewhere or in the replacement.
      if (issue.origin.kind === 'ai') aiIssuesRef.current = aiIssuesRef.current.filter((i) => i.id !== issue.id);
      hide(issue.id);
      setPopover(null);
      announce('Change applied. Undo is available.');
      // Move to the next issue so keyboard users can keep going.
      const rest = findings.filter((f) => f.id !== issue.id);
      setActiveId(rest[0]?.id ?? null);
      editor.commands.focus();
    } else {
      announce('The text changed. Updating suggestions…');
      schedulerRef.current?.schedule(true);
    }
  }

  function hide(id) {
    setHidden((h) => new Set(h).add(id));
  }

  async function dismiss(issue, { reported = false } = {}) {
    const req = currentRequest();
    const record = req && issue.sourceRevision === revisionRef.current ? dismissalFor(req.snapshot, issue) : null;
    if (record) await addDismissal(record);
    if (issue.origin.kind === 'ai') aiIssuesRef.current = aiIssuesRef.current.filter((i) => i.id !== issue.id);
    count(`suggestion.${reported ? 'reported' : 'dismissed'}.${issue.category}`);
    hide(issue.id);
    setPopover(null);
    if (reported) announce('Thanks. The report says only which kind of check was wrong.');
  }

  function changePrefs(patch, { recheck = true } = {}) {
    const next = { ...prefsRef.current, ...patch };
    const saved = savePrefs(next);
    if (recheck) bumpSettings();
    return saved;
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

  return {
    revision, settingsRevision, revisionRef, settingsRevRef, envelope, findings, activeId, setActiveId, checkStatus, profile,
    popover, setPopover, revealRef, revealTick, rangesRef, schedulerRef, currentRequest,
    updateProfile, reset, bumpSettings, onEditorUpdate, isStale, selectIssue, moveIssue, accept, dismiss,
    changePrefs, addWord, disableRule, addAiFindings,
    retry: () => schedulerRef.current?.retry(),
  };
}
