// Harper adapter: lints each prose block and returns RawFindings with
// verified UTF-16 ranges. The linter is injected, so the same adapter runs
// with LocalLinter in Node (eval, tests) and inside the analysis worker.
//
// Offsets: harper.js 2.13.0 returns UTF-16 spans in JavaScript although its
// docs describe Unicode scalar values. We accept a span only when the text at
// that range equals the lint's problem text, trying UTF-16 first and then
// scalar conversion, so a change in Harper cannot cause wrong-range edits.

import { scalarToUtf16, isValidRange } from '../text/offsets.js';
import { nonProseSpans, overlapsAny, sentences } from '../text/segment.js';

export const HARPER_VERSION = '2.13.0';

// Rules off by default. Evidence: eval/harness/rules-report.js on the dev
// split, 2026-10-29 (hits on annotated errors / misses on clean text):
// OrthographicConsistency 0/3 ("Sam" -> "SAM"), SplitWords 2/5 ("retryable"
// -> "retry able"), OkToOkay 0/1, DayOneNames 0/1, OxfordComma 0/5 (a
// preference, not an error), and the expansion and formatting rules below
// (0 hits each) that rewrite deliberate shorthand such as "min", "FYI",
// "4 B", or a hyphen in a numeric range. Users can re-enable any rule.
// Second round, 2026-10-29 on the enlarged dev split (299 cases): more
// expansion rules with no hits (ExpandTimeShorthands 0/6 on "ms" and "min",
// ExpandConfiguration, ExpandStandardInputAndOutput), MissingPreposition
// 0/5, PhrasalVerbAsCompoundNoun 0/2 ("checkout"), AvoidCurses 0/1 (a
// surname), DisjointPrefixes 0/1 ("re-enter"), and TheMy, whose fix for
// "its the" deletes a word; the confusables rule handles those.
export const DEFAULT_OFF_RULES = [
  'OrthographicConsistency', 'SplitWords', 'OkToOkay', 'DayOneNames', 'OxfordComma',
  'ExpandMinimum', 'ForYourInformation', 'ExpandMemoryShorthands', 'NumericRangeEnDash',
  'ArriveOnWeekday', 'HaveTakeALook', 'MergeWords', 'CompoundNouns',
  'ExpandTimeShorthands', 'ExpandConfiguration', 'ExpandStandardInputAndOutput', 'MissingPreposition',
  'PhrasalVerbAsCompoundNoun', 'AvoidCurses', 'DisjointPrefixes', 'TheMy',
];

// Harper's suggestion is wrong for these; the corpus says what people mean.
/** @type {Record<string, Record<string, string[]>>} rule -> lowercased problem text -> replacements */
export const REPLACEMENT_FIXES = {
  WrongNegative: { untill: ['until'] },
  EllipsisLength: { '..': ['.', '...'] },
};

// Rules Harper reports under a style-like kind (Word Choice, Miscellaneous,
// Enhancement) although the finding is a definite mistake. Same evidence run:
// every finding of each rule landed on an annotated error (ThenThan 8/0,
// ModalOf 5/0, WrongNegative 3/0, EllipsisLength 2/0, the rest 1/0). They
// are reported as likely errors in the category the eval corpus uses.
/** @type {Record<string, [Category, Classification]>} */
export const RULE_OVERRIDES = {
  ThenThan: ['word-choice', 'likely-error'],
  ModalOf: ['word-choice', 'likely-error'],
  WrongNegative: ['spelling', 'likely-error'],
  EllipsisLength: ['punctuation', 'likely-error'],
  ToTwoToo: ['word-choice', 'likely-error'],
  NounVerbConfusion: ['word-choice', 'likely-error'],
  Cant: ['punctuation', 'likely-error'],
  PronounContraction: ['grammar', 'likely-error'],
  LetsConfusion: ['punctuation', 'likely-error'],
};

// Rules skipped when the document's writing goal is casual: lowercase
// sentence starts and "i" are deliberate in texts and chat ("hey, running
// late"), as are "thru", "tho", and "honestly" (CapitalizePersonalPronouns
// 3/45 on the casual cases).
export const CASUAL_OFF_RULES = new Set(['SentenceCapitalization', 'CapitalizePersonalPronouns', 'ExpandThrough', 'ExpandThough', 'DiscourseMarkers']);

// Chat shorthand that is not a misspelling in casual writing.
export const CASUAL_WORDS = new Set([
  'u', 'ur', 'bc', 'b4', 'pls', 'plz', 'thx', 'ty', 'tbh', 'idk', 'imo', 'imho', 'btw', 'fyi', 'asap',
  'lol', 'omg', 'brb', 'ttyl', 'np', 'nvm', 'rn', 'tmrw', 'tho', 'cuz', 'gonna', 'wanna', 'gotta',
  'kinda', 'sorta', 'dunno', 'ya', 'yep', 'yup', 'nope', 'ok', 'okay', "y'know", 'ppl', 'msg', 'w/', 'w/o',
  'im', 'ive', 'mon', 'tues', 'tue', 'weds', 'wed', 'thurs', 'thu', 'fri', 'sat', 'sun', 'wknd', 'bday', 'convo', 'def', 'prob', 'obvs', 'fomo', 'vibes', 'lmk', 'ikr', 'omw', 'hbu', 'wya', 'fr', 'ngl', 'smh', 'tbd', 'eta',
]);

// Everyday technical and modern words missing from Harper's dictionary.
// Added through the user dictionary path, so personal entries still win.
export const EXTRA_WORDS = [
  'wifi', 'bluetooth', 'runbook', 'runbooks', 'retryable', 'retryables', 'chaperone', 'chaperones',
  'hirer', 'hirers', 'onboarding', 'offboarding', 'rollout', 'rollouts', 'backend', 'backends',
  'frontend', 'frontends', 'login', 'logins', 'signup', 'signups', 'webhook', 'webhooks', 'changelog',
  'changelogs', 'roadmap', 'roadmaps', 'timebox', 'timeboxed', 'uptime', 'downtime', 'retest', 'retests',
  'subfolder', 'subfolders', 'podcast', 'podcasts', 'emoji', 'emojis', 'selfie', 'selfies', 'livestream',
  'livestreams', 'hashtag', 'hashtags', 'smartwatch', 'smartwatches', 'airfryer', 'doomscrolling', 'helpdesk',
  'kubectl', 'stdout', 'stderr', 'stdin', 'wireframe', 'wireframes', 'deadband', 'habanero', 'fomo', 'playbook', 'playbooks', 'postmortem',
  'postmortems', 'standup', 'standups', 'sprint', 'sprints', 'backlog', 'microservice', 'microservices', 'middleware',
  // Doubled-l spellings are accepted in American English too.
  'cancelled', 'cancelling', 'travelled', 'travelling', 'traveller', 'travellers', 'labelled', 'labelling', 'modelled',
  'modelling', 'counselling', 'counsellor', 'counsellors', 'fuelled', 'totalled', 'signalled', 'levelled', 'cron', 'crontab', 'sudo', 'async', 'uuid', 'uuids', 'json', 'yaml', 'regex', 'regexes',
];

/** @typedef {import('../types.js').RawFinding} RawFinding */
/** @typedef {import('../types.js').Snapshot} Snapshot */
/** @typedef {import('../types.js').Settings} Settings */
/** @typedef {import('../types.js').Category} Category */
/** @typedef {import('../types.js').Classification} Classification */

/** @type {Record<string, [Category, Classification]>} */
const KIND_MAP = {
  Spelling: ['spelling', 'likely-error'],
  Typo: ['spelling', 'likely-error'],
  Grammar: ['grammar', 'likely-error'],
  Agreement: ['grammar', 'likely-error'],
  WordOrder: ['grammar', 'likely-error'],
  BoundaryError: ['grammar', 'likely-error'],
  Malapropism: ['word-choice', 'likely-error'],
  Eggcorn: ['word-choice', 'likely-error'],
  Usage: ['word-choice', 'likely-error'],
  Punctuation: ['punctuation', 'likely-error'],
  Capitalization: ['capitalization', 'likely-error'],
  Repetition: ['repetition', 'likely-error'],
  Redundancy: ['conciseness', 'style'],
  Readability: ['readability', 'style'],
  WordChoice: ['word-choice', 'style'],
  Style: ['word-choice', 'style'],
  Enhancement: ['word-choice', 'style'],
  Nonstandard: ['word-choice', 'style'],
  Regionalism: ['word-choice', 'style'],
  Formatting: ['other', 'style'],
  Miscellaneous: ['other', 'style'],
};

const DIALECTS = { 'en-US': 0, 'en-GB': 1, 'en-AU': 2, 'en-CA': 3, 'en-IN': 4 };

// SuggestionKind values from harper.js.
const REPLACE = 0;
const REMOVE = 1;
const INSERT_AFTER = 2;

/**
 * @param {import('harper.js').Linter} linter
 * @param {{ policy?: boolean }} [options] policy: false gives unfiltered
 *   Harper with its default rules, as an eval baseline.
 */
export function createHarperEngine(linter, { policy = true } = {}) {
  let configuredKey = '';

  /** @param {Settings} settings */
  async function configure(settings) {
    const key = JSON.stringify([settings.dialect ?? 'en-US', [...(settings.dictionary ?? [])].sort()]);
    if (key === configuredKey) return;
    // setDialect resets Harper's rule config (harper.js 2.13.0), so the
    // config is applied after it, every time.
    await linter.setDialect(DIALECTS[settings.dialect ?? 'en-US'] ?? 0);
    const config = await linter.getDefaultLintConfig();
    if (policy) for (const rule of DEFAULT_OFF_RULES) if (rule in config) config[rule] = false;
    await linter.setLintConfig(config);
    await linter.clearWords();
    const words = [...(policy ? EXTRA_WORDS : []), ...(settings.dictionary ?? [])];
    if (words.length) await linter.importWords(words);
    configuredKey = key;
  }

  const engine = {
    name: policy ? 'harper' : 'harper-raw',
    version: HARPER_VERSION,
    setup: () => linter.setup(),

    /**
     * @param {Snapshot} snapshot
     * @param {Settings} settings
     * @param {Set<string>} [blockIds] limit to these blocks
     * @returns {Promise<{ findings: RawFinding[], rejected: number }>}
     */
    async run(snapshot, settings, blockIds) {
      await configure(settings);
      /** @type {RawFinding[]} */
      const findings = [];
      let rejected = 0;
      const names = policy ? documentNames(snapshot) : new Set();
      for (const block of snapshot.blocks) {
        if (block.type === 'codeBlock' || !block.text.trim()) continue;
        if (blockIds && !blockIds.has(block.id)) continue;
        const skip = [
          ...nonProseSpans(block.text),
          ...block.marks.filter((m) => m.type === 'code'),
        ];
        const starts = sentenceStarts(block.text);
        const nameLine = policy && isNameLine(block.text);
        const organized = await linter.organizedLints(block.text, { language: 'plaintext' });
        const casual = policy && settings.goals?.formality === 'casual';
        for (const [rule, lints] of Object.entries(organized)) {
          if (casual && CASUAL_OFF_RULES.has(rule)) {
            for (const lint of lints) lint.free?.();
            continue;
          }
          for (const lint of lints) {
            const raw = toRaw(block, rule, lint, policy);
            if (!raw) rejected++;
            else if (
              !overlapsAny(skip, raw.from, raw.to) &&
              !(casual && (isCasualWord(raw, block.text) || isCaseOnlyFix(raw, block.text))) &&
              !(policy && likelyProperNoun(raw, block.text, starts, names)) &&
              !(policy && nameLine && raw.category === 'spelling') &&
              !(policy && isAcronym(raw, block.text)) &&
              !(policy && isCodeLike(raw, block.text)) &&
              !(policy && isUnitLetter(raw, block.text)) &&
              !(policy && (await isDerivedKnownWord(raw, block.text)))
            ) {
              findings.push(policy ? fixReplacements(rule, raw, block.text) : raw);
            }
            lint.free?.();
          }
        }
      }
      return { findings, rejected };
    },
  };

  /**
   * A word Harper doesn't know may be a known word with a common prefix
   * ("misconfigured", "undercooked", "coworking"). Accept it when the
   * remainder passes Harper's spell check. Suffixes are deliberately not
   * stripped: that accepted real inflection errors in the dev set
   * ("prefered", "begining", "childrens", "coachs").
   * @param {RawFinding} raw @param {string} text
   */
  async function isDerivedKnownWord(raw, text) {
    if (raw.ruleId !== 'harper.SpellCheck') return false;
    const word = text.slice(raw.from, raw.to);
    for (const stem of stems(word)) {
      if (stem.length < 4) continue;
      const lints = await linter.lint(stem, { language: 'plaintext' });
      const misspelled = lints.some((l) => l.lint_kind() === 'Spelling');
      for (const l of lints) l.free?.();
      if (!misspelled) return true;
    }
    return false;
  }

  return engine;
}

const PREFIXES = ['mis', 'under', 'over', 'co', 're', 'pre', 'un', 'non', 'sub', 'multi', 'inter', 'de'];

/** Candidate stems after removing one common prefix. @param {string} word */
export function stems(word) {
  const lower = word.toLowerCase();
  if (!/^[a-z-]+$/u.test(lower)) return [];
  return PREFIXES.filter((p) => lower.startsWith(p)).map((p) => lower.slice(p.length).replace(/^-/u, ''));
}

/** Capitalized words that sit mid-sentence anywhere in the document: names the dictionary lacks. */
function documentNames(snapshot) {
  const names = new Set();
  for (const b of snapshot.blocks) {
    if (b.type === 'codeBlock') continue;
    const starts = sentenceStarts(b.text);
    for (const m of b.text.matchAll(/\p{Lu}[\p{L}'’-]+/gu)) if (!starts.has(m.index)) names.add(m[0]);
  }
  return names;
}

/** A block that is only one to three capitalized words ("Jen", "Priya Nair"): a sign-off or a name. */
export function isNameLine(text) {
  const words = text.trim().replace(/[,.!]+$/u, '').split(/\s+/u);
  return words.length <= 3 && words.every((w) => /^\p{Lu}[\p{L}'’.-]*$/u.test(w));
}

/** In casual writing, "sunday" and "friday" are left alone: the fix would only change case. */
export function isCaseOnlyFix(raw, text) {
  if (raw.category !== 'spelling' || !raw.replacements?.length) return false;
  const word = text.slice(raw.from, raw.to).toLowerCase();
  return raw.replacements.some((r) => r.toLowerCase() === word);
}

/** Paths, identifiers, and commands ("secret/helpdesk/zendesk", "kubectl", "my_var", "v2.1"). */
export function isCodeLike(raw, text) {
  if (raw.category !== 'spelling') return false;
  let from = raw.from;
  let to = raw.to;
  while (from > 0 && !/\s/u.test(text[from - 1])) from--;
  while (to < text.length && !/\s/u.test(text[to])) to++;
  const token = text.slice(from, to).replace(/^[("'“‘[]+|[)"'”’\].,;:!?]+$/gu, '');
  return /[/\\_]|\p{L}\.\p{L}|\p{L}\d|\d\p{L}|^[a-z]+[A-Z]/u.test(token);
}

/** A one- or two-letter unit after a number ("1.2 s", "45 ms", "3 kg"). */
export function isUnitLetter(raw, text) {
  if (raw.category !== 'spelling' || raw.to - raw.from > 2) return false;
  return /\d\s*$/u.test(text.slice(0, raw.from)) && /^[a-z]{1,2}$/u.test(text.slice(raw.from, raw.to));
}

/** Replace suggestions the corpus showed to be wrong (REPLACEMENT_FIXES). */
function fixReplacements(rule, raw, text) {
  const fixes = REPLACEMENT_FIXES[rule]?.[text.slice(raw.from, raw.to).toLowerCase()];
  return fixes ? { ...raw, replacements: fixes } : raw;
}

/** Chat shorthand ("u", "bc", "y'know") is not a misspelling in casual writing. */
export function isCasualWord(raw, text) {
  return raw.category === 'spelling' && CASUAL_WORDS.has(text.slice(raw.from, raw.to).toLowerCase());
}

/** All-caps tokens such as "SSO" or "APIs" are acronyms, not misspellings. */
export function isAcronym(raw, text) {
  return raw.category === 'spelling' && /^\p{Lu}{2,}s?$/u.test(text.slice(raw.from, raw.to));
}

/** Offsets where a sentence (or a quotation inside one) begins. @param {string} text */
function sentenceStarts(text) {
  const starts = new Set(sentences(text).map((s) => s.from));
  for (const m of text.matchAll(/["“(]\s*/gu)) starts.add(m.index + m[0].length);
  return starts;
}

/**
 * A spelling finding on a capitalized word that does not start a sentence is
 * almost always a name the dictionary lacks (62 of 81 dev-set false
 * positives). Keep it when the fix only adds an apostrophe ("Janets" ->
 * "Janet's"), which is a real error.
 * @param {RawFinding} raw @param {string} text @param {Set<number>} starts
 */
export function likelyProperNoun(raw, text, starts, names = new Set()) {
  if (raw.category !== 'spelling') return false;
  const word = text.slice(raw.from, raw.to);
  if (!/^\p{Lu}/u.test(word)) return false;
  // At a sentence start, only a word seen mid-sentence elsewhere counts as a name.
  if (starts.has(raw.from) && !names.has(word)) return false;
  const apostropheFix = (raw.replacements ?? []).some((r) => r.replace(/['’]/gu, '') === word && r !== word);
  return !apostropheFix;
}

/**
 * @param {import('../types.js').Block} block
 * @param {string} rule
 * @param {import('harper.js').Lint} lint
 * @param {boolean} [policy] apply RULE_OVERRIDES
 * @returns {RawFinding | null}
 */
function toRaw(block, rule, lint, policy = true) {
  const span = lint.span();
  const problem = lint.get_problem_text();
  const range = resolveSpan(block.text, span.start, span.end, problem);
  span.free?.();
  if (!range) return null;
  const [category, classification] = (policy && RULE_OVERRIDES[rule]) || KIND_MAP[lint.lint_kind()] || ['other', 'style'];
  const replacements = lint.suggestions().map((s) => {
    const kind = s.kind();
    const text = s.get_replacement_text();
    s.free?.();
    if (kind === REMOVE) return '';
    if (kind === INSERT_AFTER) return problem + text;
    return kind === REPLACE ? text : null;
  });
  return {
    blockId: block.id,
    from: range[0],
    to: range[1],
    ruleId: `harper.${rule}`,
    category,
    classification,
    message: lint.message(),
    replacements: replacements.filter((r) => r !== null).map(normalizeReplacement(problem)),
  };
}

/**
 * Harper sometimes offers a variant with trailing whitespace the source
 * doesn't have ("They're "); keep the source's trailing whitespace instead.
 * @param {string} problem
 */
function normalizeReplacement(problem) {
  const trailing = /\s*$/u.exec(problem)?.[0] ?? '';
  return (/** @type {string} */ r) => (r.trim() ? r.replace(/\s*$/u, trailing) : r);
}

/**
 * @param {string} text @param {number} start @param {number} end @param {string} problem
 * @returns {[number, number] | null}
 */
export function resolveSpan(text, start, end, problem) {
  if (isValidRange(text, start, end) && text.slice(start, end) === problem) return [start, end];
  const from = scalarToUtf16(text, start);
  const to = scalarToUtf16(text, end);
  if (from >= 0 && to >= 0 && isValidRange(text, from, to) && text.slice(from, to) === problem) return [from, to];
  return null;
}
