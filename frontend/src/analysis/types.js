// Shared JSDoc types for the analysis core. The JSON Schemas in
// contracts/schemas are the source of truth; these mirror them for editors.

/**
 * @typedef {{ from: number, to: number, type: 'bold'|'italic'|'code'|'link', href?: string }} MarkSpan
 * @typedef {{ id: string, type: 'paragraph'|'heading'|'listItem'|'blockquote'|'codeBlock',
 *   level?: number, text: string, marks: MarkSpan[], fingerprint: string }} Block
 * @typedef {{ contractVersion: 1, documentId: string, revision: number, settingsRevision: number,
 *   schemaVersion: number, blocks: Block[] }} Snapshot
 *
 * @typedef {{ blockId: string, from: number, to: number, expectedText: string }} Anchor
 * @typedef {{ blockId: string, quote: string, before?: string, after?: string }} Evidence
 * @typedef {{ kind: 'local'|'ai', engine: string, engineVersion: string, ruleId: string,
 *   requestId?: string, model?: string, promptVersion?: string }} Origin
 * @typedef {'spelling'|'grammar'|'punctuation'|'capitalization'|'word-choice'|'repetition'|
 *   'conciseness'|'sentence-length'|'readability'|'passive-voice'|'hedging'|'tone'|'clarity'|
 *   'consistency'|'other'} Category
 * @typedef {'likely-error'|'style'|'review-question'} Classification
 * @typedef {'minor'|'meaningful'|'critical'} Severity
 * @typedef {{ contractVersion: 1, id: string, documentId: string, sourceRevision: number,
 *   settingsRevision: number, origin: Origin, category: Category, classification: Classification,
 *   severity: Severity, anchor?: Anchor, evidence?: Evidence[], message: string,
 *   replacements: { text: string }[], state: 'current'|'stale'|'dismissed'|'applied' }} Issue
 *
 * @typedef {{ requestedScope: 'document'|'selection'|'blocks', analyzedBlockIds: string[],
 *   contextBlockIds: string[], modes: string[], partial: boolean, limitations: string[] }} Coverage
 * @typedef {{ contractVersion: 1, requestId: string, documentId: string, sourceRevision: number,
 *   settingsRevision: number, status: 'completed'|'failed'|'cancelled', coverage: Coverage,
 *   summary: string, findings: Issue[], rejectedFindingCount: number }} Envelope
 *
 * @typedef {{ dialect?: 'en-US'|'en-GB'|'en-AU'|'en-CA'|'en-IN', dictionary?: string[],
 *   disabledRules?: string[], longSentenceWords?: number,
 *   goals?: { audience?: string, formality?: 'casual'|'neutral'|'formal', intent?: string } }} Settings
 *
 * Raw finding produced by an engine or rule before it becomes an Issue.
 * @typedef {{ blockId: string, from: number, to: number, ruleId: string, category: Category,
 *   classification: Classification, severity?: Severity, message: string,
 *   replacements?: string[] }} RawFinding
 */

export {};
