// Display labels for issue categories and statuses.

export const CATEGORY_LABELS = {
  spelling: 'Spelling',
  grammar: 'Grammar',
  punctuation: 'Punctuation',
  capitalization: 'Capitalization',
  'word-choice': 'Word choice',
  repetition: 'Repetition',
  conciseness: 'Conciseness',
  'sentence-length': 'Long sentence',
  readability: 'Readability',
  'passive-voice': 'Passive voice',
  hedging: 'Hedging',
  tone: 'Tone',
  clarity: 'Clarity',
  consistency: 'Consistency',
  other: 'Other',
};

export const CHECK_STATUS_LABELS = {
  idle: 'Not checked yet',
  waiting: 'Waiting to check…',
  checking: 'Checking…',
  current: 'Checked',
  paused: 'Checking paused',
  failed: 'Checking failed',
  unavailable: 'Checking unavailable',
};

export const SAVE_STATUS_LABELS = {
  saved: 'Saved on this device',
  unsaved: 'Unsaved changes',
  saving: 'Saving…',
  error: 'Not saved',
  conflict: 'Changed in another tab',
  deleted: 'Deleted in another tab',
};

export const DIALECTS = [
  ['en-US', 'English (US)'],
  ['en-GB', 'English (UK)'],
  ['en-CA', 'English (Canada)'],
  ['en-AU', 'English (Australia)'],
  ['en-IN', 'English (India)'],
];
