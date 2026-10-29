import { useEffect, useRef, useState } from 'react';
import * as db from '../documents/db.js';
import { advanceGoal, todayKey } from './goal.js';
import { EditorContent } from '@tiptap/react';
import * as connections from '../ai/connections.js';
import { AssistPanel } from './AssistPanel.jsx';
import { IssuePopover } from './IssuePopover.jsx';
import { SettingsDialog } from './SettingsDialog.jsx';
import { HistoryDialog } from './HistoryDialog.jsx';
import { Sidebar } from './Sidebar.jsx';
import { Topbar } from './Topbar.jsx';
import { FormatBar } from './FormatBar.jsx';
import { FindBar } from './FindBar.jsx';
import { AiPanel } from './AiPanel.jsx';
import { useAiReview } from './useAiReview.js';
import { IconReview } from './icons.jsx';
import { CHECK_STATUS_LABELS } from './labels.js';
import { count } from './telemetry.js';
import { useDocuments } from './hooks/useDocuments.js';
import { useProofreading } from './hooks/useProofreading.js';
import { useDocumentEditor } from './hooks/useDocumentEditor.js';
import { useImportExport } from './hooks/useImportExport.js';
import { useExtensionBridge } from './hooks/useExtensionBridge.js';
import { useShortcuts } from './hooks/useShortcuts.js';
import { useFolderSync } from './hooks/useFolderSync.js';

/**
 * Composition only: documents and preferences (useDocuments), local checking
 * (useProofreading), the editor (useDocumentEditor), export, the extension
 * bridge, shortcuts, and the AI review workflow. Each hook owns its state.
 */
export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [assistOpen, setAssistOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > 900);
  const [focusMode, setFocusMode] = useState(false);
  const [storageNoticeHidden, setStorageNoticeHidden] = useState(false);
  const [assistTab, setAssistTab] = useState('suggestions');
  const [findOpen, setFindOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const editorRef = useRef(/** @type {import('@tiptap/core').Editor | null} */ (null));
  const pendingImport = useRef(/** @type {{ html: string, parseOptions?: object } | null} */ (null));
  // Opening a document resets hooks created below, and a save notifies folder
  // sync; the refs break the cycles.
  const onOpenRef = useRef(() => {});
  const onSavedRef = useRef((/** @type {any} */ _doc) => {});

  const documents = useDocuments({
    editorRef,
    pendingImport,
    onOpen: () => onOpenRef.current(),
    onHandoff: (handoff) => {
      if (handoff.intent === 'paraphrase') {
        setAssistTab('ai');
        setAssistOpen(true);
      }
    },
    announce: setAnnouncement,
    onSaved: (saved) => onSavedRef.current(saved),
  });
  const { doc, docRef, prefs, prefsRef, prefsLoaded, dismissalsRef, saveStatus, save, loadKey } = documents;

  const folderSync = useFolderSync({
    prefsLoaded,
    docRef,
    editorRef,
    refreshDocs: documents.refreshDocs,
    openDocument: documents.openDocument,
    announce: setAnnouncement,
  });
  onSavedRef.current = folderSync.onSaved;

  const proofreading = useProofreading({
    editorRef,
    docRef,
    prefsRef,
    dismissalsRef,
    prefs,
    prefsLoaded,
    savePrefs: documents.savePrefs,
    addDismissal: documents.addDismissal,
    announce: setAnnouncement,
  });
  const { findings, activeId, checkStatus, profile, popover, setPopover, envelope, revision, currentRequest } = proofreading;

  const { editor, selectionWords } = useDocumentEditor({
    doc,
    loadKey,
    editorRef,
    pendingImport,
    proofreading,
    scheduleSave: documents.scheduleSave,
    typewriter: Boolean(prefs.typewriter),
  });

  const { exportAs, taskCompleted } = useImportExport({ currentRequest, docRef, announce: setAnnouncement });

  const activeAi = connections.activeConnection(documents.ai);
  const aiReview = useAiReview({
    editorRef,
    currentRequest,
    revisionRef: proofreading.revisionRef,
    settingsRevRef: proofreading.settingsRevRef,
    docRef,
    connection: activeAi,
    onFindings: proofreading.addAiFindings,
    onApplied: taskCompleted,
    announce: setAnnouncement,
  });
  onOpenRef.current = () => {
    proofreading.reset();
    aiReview.reset();
  };

  const { extensionLink, sendBack } = useExtensionBridge({
    prefsLoaded,
    importText: documents.importText,
    currentRequest,
    announce: setAnnouncement,
    taskCompleted,
  });

  useShortcuts({
    moveIssue: proofreading.moveIssue,
    save,
    toggleFocus: () => setFocusMode((f) => !f),
    onFind: () => setFindOpen(true),
    onEscape: () => {
      if (!popover && focusMode) setFocusMode(false);
    },
  });

  // Daily word goal: growth of each document's count adds to today's total.
  const [goalProgress, setGoalProgress] = useState({ date: todayKey(), words: 0 });
  const baselines = useRef(new Map());
  useEffect(() => {
    db.getPref('goalProgress', null).then((p) => { if (p && typeof p.words === 'number') setGoalProgress(p); }).catch(() => {});
  }, []);
  useEffect(() => {
    if (!doc || !profile) return;
    const next = advanceGoal(goalProgress, baselines.current, doc.id, profile.counts.words);
    if (next !== goalProgress) {
      setGoalProgress(next);
      db.setPref('goalProgress', next).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id, profile?.counts.words]);
  const goal = prefs.wordGoal > 0 ? { target: prefs.wordGoal, words: goalProgress.date === todayKey() ? goalProgress.words : 0 } : null;

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
  const issueHandlers = {
    onAccept: proofreading.accept,
    onDismiss: (issue) => proofreading.dismiss(issue),
    onReport: (issue) => proofreading.dismiss(issue, { reported: true }),
    onAddWord: proofreading.addWord,
    onDisableRule: proofreading.disableRule,
    isStale: proofreading.isStale,
  };

  return (
    <div className={`app${focusMode ? ' focus-mode' : ''}`}>
      {/* Targets the editable document itself, so following it puts the cursor there. */}
      <a href="#document" className="skip-link">Skip to editor</a>
      <Topbar
        title={doc?.title ?? ''}
        onTitle={(title) => documents.updateDoc({ title })}
        saveStatus={saveStatus}
        goals={doc?.goals ?? {}}
        onGoals={(g) => {
          documents.updateDoc({ goals: { ...(docRef.current?.goals ?? {}), ...g } });
          proofreading.updateProfile();
          // Formality changes which checks apply, so results from before are stale.
          if ('formality' in g) proofreading.bumpSettings();
        }}
        onExport={exportAs}
        onSettings={() => setSettingsOpen(true)}
        drawerOpen={drawerOpen}
        onToggleDrawer={() => setDrawerOpen((o) => !o)}
        focusMode={focusMode}
        onToggleFocus={() => setFocusMode((f) => !f)}
      />
      <FormatBar editor={editor} onFind={() => setFindOpen((o) => !o)} findOpen={findOpen} />
      {findOpen && <FindBar editor={editor} onClose={() => setFindOpen(false)} />}
      <Sidebar
        open={drawerOpen && !focusMode}
        docs={documents.docs}
        currentId={doc?.id ?? null}
        onOpen={(id) => {
          documents.openDocument(id);
          if (window.innerWidth <= 900) setDrawerOpen(false);
        }}
        onNew={documents.newDocument}
        onDelete={documents.removeDocument}
        onPin={(id, pinned) => documents.setDocMeta(id, { pinned })}
        onTags={(id, tags) => documents.setDocMeta(id, { tags })}
        onImport={documents.importFile}
        recovery={documents.recovery}
        onHistory={() => setHistoryOpen(true)}
      />
      <main className="desk" id="editor">
        {documents.storageError && <p className="banner banner--error" role="alert">{documents.storageError}</p>}
        {saveStatus === 'conflict' && (
          <div className="banner banner--warning" role="alert">
            This document was changed in another tab.
            <button type="button" className="btn btn--sm btn--secondary" onClick={() => documents.resolveConflict(false)}>Load that version</button>
            <button type="button" className="btn btn--sm" onClick={() => documents.resolveConflict(true)}>Keep this version</button>
          </div>
        )}
        {saveStatus === 'deleted' && (
          <div className="banner banner--warning" role="alert">
            This document was deleted in another tab.
            <button type="button" className="btn btn--sm btn--secondary" onClick={() => documents.resolveDeleted(false)}>Close it</button>
            <button type="button" className="btn btn--sm" onClick={() => documents.resolveDeleted(true)}>Keep it</button>
          </div>
        )}
        {extensionLink && extensionLink.docId === doc?.id && (
          <div className="banner banner--info" role="region" aria-label="Browser extension">
            From {extensionLink.from}. When you are done, send the text back to replace your selection there.
            <button type="button" className="btn btn--sm" onClick={sendBack}>Send back</button>
          </div>
        )}
        {folderSync.state.status === 'needs-permission' && (
          <div className="banner banner--info" role="region" aria-label="Folder">
            Reconnect the folder “{folderSync.state.name}” to keep saving Markdown files there.
            <button type="button" className="btn btn--sm" onClick={folderSync.reconnect}>Reconnect folder</button>
          </div>
        )}
        {folderSync.conflicts.map((c) => (
          <div key={c.id} className="banner banner--warning" role="alert">
            “{c.fileName}” changed in the folder and “{c.title}” was also edited here.
            <button type="button" className="btn btn--sm btn--secondary" onClick={() => folderSync.resolveConflict(c.id, true)}>Load the file</button>
            <button type="button" className="btn btn--sm" onClick={() => folderSync.resolveConflict(c.id, false)}>Keep this version</button>
          </div>
        ))}
        {saveStatus === 'error' && (
          <div className="banner banner--error" role="alert">
            Your latest changes are not saved.
            <button type="button" className="btn btn--sm" onClick={() => save()}>Try again</button>
            or export your work.
          </div>
        )}
        {documents.persisted === false && !storageNoticeHidden && (
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
        onSelect={proofreading.selectIssue}
        onRetry={proofreading.retry}
        onReturnFocus={() => editor?.commands.focus()}
        onOutlineSelect={(pos) => editor?.chain().focus().setTextSelection(pos).scrollIntoView().run()}
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
        {goal && (
          <span className="goal" title={`Daily goal: ${goal.target.toLocaleString()} words. Counts words added today across all documents.`}>
            <svg className="goal__ring" viewBox="0 0 20 20" aria-hidden="true">
              <circle cx="10" cy="10" r="8" />
              <circle cx="10" cy="10" r="8" pathLength="100" strokeDasharray={`${Math.min(100, (goal.words / goal.target) * 100)} 100`} />
            </svg>
            <span className="goal__text">{goal.words.toLocaleString()} / {goal.target.toLocaleString()} today</span>
          </span>
        )}
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
      <HistoryDialog
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title={doc?.title ?? ''}
        versions={documents.recovery}
        currentContent={documents.currentContent}
        onRestore={documents.restore}
        onSaveNow={documents.saveVersion}
      />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        prefs={prefs}
        persisted={documents.persisted}
        onChange={(patch) => proofreading.changePrefs(patch, { recheck: !('paused' in patch || 'typewriter' in patch || 'wordGoal' in patch) })}
        onRemoveWord={(w) => proofreading.changePrefs({ dictionary: prefsRef.current.dictionary.filter((x) => x !== w) })}
        onEnableRule={(id) => proofreading.changePrefs({ disabledRules: prefsRef.current.disabledRules.filter((x) => x !== id) })}
        onExportLibrary={documents.exportLibrary}
        onImportLibrary={documents.importLibrary}
        folder={folderSync}
        ai={documents.ai}
        onAiChange={documents.changeAi}
        onAiConnected={() => count('ai.connection.added')}
      />
    </div>
  );
}
