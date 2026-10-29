import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createNodeHarperEngine } from '../../src/analysis/engines/harper-node.js';
import { HARPER_VERSION, resolveSpan } from '../../src/analysis/engines/harper.js';
import { createRulesEngine } from '../../src/analysis/rules/index.js';
import { snapshotFromMarkdown, snapshotFromText } from '../../src/analysis/snapshot/from-markdown.js';
import { analyze } from '../../src/analysis/pipeline.js';
import { validator } from '../helpers/contracts.js';
import { dismissalFor } from '../../src/analysis/issues/dismissals.js';
import { findConflicts } from '../../src/analysis/issues/merge.js';

const harper = createNodeHarperEngine();
const rules = createRulesEngine();
beforeAll(() => harper.setup());

const textsOf = (/** @type {any} */ env, snap) =>
  env.findings.map((f) => snap.blocks.find((b) => b.id === f.anchor.blockId).text.slice(f.anchor.from, f.anchor.to));

describe('harper adapter', () => {
  it('pins the installed version', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../node_modules/harper.js/package.json', import.meta.url), 'utf8'));
    expect(HARPER_VERSION).toBe(pkg.version);
  });

  it('anchors exactly after emoji, astral letters, ZWJ sequences, and combining marks', async () => {
    for (const prefix of ['A😀 ', '𝒜𝒜 ', '👨‍👩‍👧 ', 'café ']) {
      const snap = snapshotFromText(`${prefix}teh plan`);
      const { findings } = await harper.run(snap, {});
      const f = findings.find((x) => x.ruleId === 'harper.The' || x.category === 'spelling');
      expect(f, prefix).toBeDefined();
      expect(snap.blocks[0].text.slice(f.from, f.to)).toBe('teh');
    }
  });

  it('falls back to scalar offsets and rejects spans that match neither', () => {
    expect(resolveSpan('A😀 teh', 4, 7, 'teh')).toEqual([4, 7]);
    expect(resolveSpan('A😀 teh', 3, 6, 'teh')).toEqual([4, 7]);
    expect(resolveSpan('A😀 teh', 0, 3, 'teh')).toBeNull();
  });

  it('skips URLs, inline code, and code blocks', async () => {
    const snap = snapshotFromMarkdown('Visit https://exampel.com/teh and run `teh --flag`.\n\n```\nteh teh\n```');
    const { findings } = await harper.run(snap, {});
    expect(findings).toEqual([]);
  });

  it('respects the personal dictionary', async () => {
    const snap = snapshotFromText('Sledgeworx ships Quuxify today.');
    const before = (await harper.run(snap, {})).findings.filter((f) => f.category === 'spelling');
    expect(before.length).toBeGreaterThan(0);
    const after = (await harper.run(snap, { dictionary: ['Sledgeworx', 'Quuxify'] })).findings.filter((f) => f.category === 'spelling');
    expect(after).toEqual([]);
  });
});

describe('rules', () => {
  const run = async (text, settings = {}) => {
    const snap = snapshotFromText(text);
    const { findings } = await rules.run(snap, settings);
    return findings.map((f) => [f.ruleId, snap.blocks[0].text.slice(f.from, f.to), f.replacements]);
  };

  it('shortens redundant phrases and keeps capitalization', async () => {
    expect(await run('In order to win, we need advance planning.')).toEqual(
      expect.arrayContaining([
        ['style.redundant-phrase', 'In order to', ['To']],
        ['style.redundant-phrase', 'advance planning', ['planning']],
      ]),
    );
  });

  it('flags nearby repetition once, ignoring names and function words', async () => {
    const found = (await run('The budget plan covers the budget for the next budget cycle. Alice told Alice.')).filter(
      ([id]) => id === 'style.nearby-repetition',
    );
    expect(found).toEqual([['style.nearby-repetition', 'budget', []]]);
  });

  it('flags long sentences above the configured threshold', async () => {
    const long = `${Array.from({ length: 12 }, (_, i) => `word${i}`).join(' ')}.`;
    expect((await run(long, { longSentenceWords: 10 })).map(([id]) => id)).toContain('style.long-sentence');
    expect((await run(long, { longSentenceWords: 20 })).map(([id]) => id)).not.toContain('style.long-sentence');
  });

  it('flags passive voice but not state adjectives', async () => {
    const ids = async (t) => (await run(t)).filter(([id]) => id === 'style.passive-voice').map(([, text]) => text);
    expect(await ids('The report was written by Sam and the bug was quickly fixed.')).toEqual(['was written', 'was quickly fixed']);
    expect(await ids('I am interested and she is tired.')).toEqual([]);
  });

  it('observes hedges without offering replacements', async () => {
    expect(await run('I think this is really good.')).toEqual(
      expect.arrayContaining([
        ['style.hedging', 'I think', []],
        ['style.hedging', 'really', []],
      ]),
    );
  });
});

describe('pipeline', () => {
  const settings = {};

  it('produces a contract-valid envelope with merged, ordered findings', async () => {
    const snap = snapshotFromMarkdown('# Plan\n\nIn order to ship, teh team is is ready.', { documentId: 'doc-1', revision: 7 });
    const { envelope } = await analyze(snap, settings, { engines: [harper, rules], requestId: 'local-1' });
    expect(validator('envelope')(envelope).errors).toEqual([]);
    expect(envelope.sourceRevision).toBe(7);
    const texts = textsOf(envelope, snap);
    expect(texts).toEqual(expect.arrayContaining(['teh', 'is is', 'In order to']));
    // Likely errors come before style observations.
    const firstStyle = envelope.findings.findIndex((f) => f.classification === 'style');
    expect(envelope.findings.slice(firstStyle).every((f) => f.classification !== 'likely-error')).toBe(true);
  });

  it('keeps finding IDs stable across reruns', async () => {
    const snap = snapshotFromText('teh cat');
    const a = (await analyze(snap, settings, { engines: [harper], requestId: 'a' })).envelope.findings.map((f) => f.id);
    const b = (await analyze(snap, settings, { engines: [harper], requestId: 'b' })).envelope.findings.map((f) => f.id);
    expect(a).toEqual(b);
  });

  it('suppresses dismissed occurrences until the block changes', async () => {
    const snap = snapshotFromText('teh cat');
    const { envelope } = await analyze(snap, settings, { engines: [harper], requestId: 'x' });
    const target = envelope.findings[0];
    const dismissal = dismissalFor(snap, target);
    const again = await analyze(snap, settings, { engines: [harper], requestId: 'y', suppressions: { occurrences: [dismissal] } });
    expect(again.envelope.findings.map((f) => f.id)).not.toContain(target.id);
    const edited = snapshotFromText('teh cat sat');
    const after = await analyze(edited, settings, { engines: [harper], requestId: 'z', suppressions: { occurrences: [dismissal] } });
    expect(textsOf(after.envelope, edited)).toContain('teh');
  });

  it('honours disabled rules', async () => {
    const snap = snapshotFromText('In order to win.');
    const { envelope } = await analyze(snap, { disabledRules: ['style.redundant-phrase'] }, { engines: [rules], requestId: 'r' });
    expect(envelope.findings.map((f) => f.origin.ruleId)).not.toContain('style.redundant-phrase');
  });

  it('reports a failing engine as partial coverage, and all failing as failed', async () => {
    const broken = { name: 'broken', version: '0', setup: async () => {}, run: async () => { throw new Error('boom'); } };
    const snap = snapshotFromText('teh cat');
    const partial = (await analyze(snap, settings, { engines: [harper, broken], requestId: 'p' })).envelope;
    expect(partial.status).toBe('completed');
    expect(partial.coverage.partial).toBe(true);
    expect(partial.findings.length).toBeGreaterThan(0);
    const failed = (await analyze(snap, settings, { engines: [broken], requestId: 'f' })).envelope;
    expect(failed.status).toBe('failed');
    expect(failed.summary).toBe('Checking is unavailable.');
  });

  it('rejects engine findings whose anchors do not match the snapshot', async () => {
    const liar = {
      name: 'liar', version: '0', setup: async () => {},
      run: async (snap) => ({
        findings: [{ blockId: snap.blocks[0].id, from: 1, to: 2, ruleId: 'x', category: 'other', classification: 'style', message: 'splits emoji' }],
        rejected: 0,
      }),
    };
    const { envelope } = await analyze(snapshotFromText('😀 ok'), settings, { engines: [liar], requestId: 'l' });
    expect(envelope.findings).toEqual([]);
    expect(envelope.rejectedFindingCount).toBe(1);
    expect(envelope.coverage.limitations.join(' ')).toMatch(/failed validation/u);
  });

  it('detects conflicting overlapping suggestions', async () => {
    const snap = snapshotFromText('In order to win.');
    const { envelope } = await analyze(snap, settings, { engines: [rules], requestId: 'c' });
    const overlapping = {
      ...envelope.findings[0], id: 'other',
      anchor: { ...envelope.findings[0].anchor, from: 3, to: 8, expectedText: 'order' },
    };
    const conflicts = findConflicts([envelope.findings[0], overlapping]);
    expect(conflicts.get('other')).toEqual([envelope.findings[0].id]);
  });
});

describe('harper policy', () => {
  it('drops spelling findings on mid-sentence names but keeps them at sentence start and for missing apostrophes', async () => {
    const texts = async (t) => {
      const snap = snapshotFromText(t);
      return (await harper.run(snap, {})).findings.filter((f) => f.category === 'spelling').map((f) => snap.blocks[0].text.slice(f.from, f.to));
    };
    expect(await texts('I met Priya Novak at Zendesk today.')).toEqual([]);
    expect(await texts('Tomorow we meet. Recieved it.')).toEqual(expect.arrayContaining(['Tomorow', 'Recieved']));
    expect(await texts('We used Janets notes.')).toEqual(['Janets']);
  });

  it('turns off the rules the dev-set evaluation found noisy, in every dialect', async () => {
    const snap = snapshotFromText('Hi Sam, the job is retryable. Sam said ok.');
    for (const dialect of ['en-US', 'en-GB', 'en-US']) {
      const rules = (await harper.run(snap, { dialect })).findings.map((f) => f.ruleId);
      expect(rules, dialect).not.toContain('harper.OrthographicConsistency');
      expect(rules, dialect).not.toContain('harper.SplitWords');
    }
  });

  it('keeps the personal dictionary after a dialect change', async () => {
    const snap = snapshotFromText('Quuxify ships today.');
    await harper.run(snap, { dialect: 'en-US', dictionary: ['Quuxify'] });
    const after = await harper.run(snap, { dialect: 'en-GB', dictionary: ['Quuxify'] });
    expect(after.findings.filter((f) => f.category === 'spelling')).toEqual([]);
  });
});

describe('spelling stems and acronyms', async () => {
  const { stems } = await import('../../src/analysis/engines/harper.js');
  it('derives candidate stems', () => {
    expect(stems('misconfigured')).toContain('configured');
    expect(stems('Coworking')).toContain('working');
    expect(stems('prefered')).toEqual(['fered']);
  });

  it('accepts derived known words and acronyms but still flags misspelled stems', async () => {
    const spelled = async (t) => {
      const snap = snapshotFromText(t);
      return (await harper.run(snap, {})).findings.filter((f) => f.category === 'spelling').map((f) => snap.blocks[0].text.slice(f.from, f.to));
    };
    expect(await spelled('The server was misconfigured, the soup undercooked, and SSO is on.')).toEqual([]);
    expect(await spelled('She recieves mail, was misconfgured, and prefered begining early.')).toEqual(
      expect.arrayContaining(['recieves', 'misconfgured', 'prefered', 'begining']),
    );
  });
});

describe('writing goals', () => {
  it('skips sentence capitalization only when the goal is casual', async () => {
    const snap = snapshotFromText('hey, running late. see you soon.');
    const rules = async (goals) => (await harper.run(snap, { goals })).findings.map((f) => f.ruleId);
    expect(await rules({})).toContain('harper.SentenceCapitalization');
    expect(await rules({ formality: 'formal' })).toContain('harper.SentenceCapitalization');
    expect(await rules({ formality: 'casual' })).not.toContain('harper.SentenceCapitalization');
  });
});

describe('harper policy: reclassified and supplemented (rules-report 2026-10-29)', () => {
  const run = async (t, settings = {}) => {
    const snap = snapshotFromText(t);
    const { findings } = await harper.run(snap, settings);
    return findings.map((f) => ({ rule: f.ruleId, cls: f.classification, cat: f.category, text: snap.blocks[0].text.slice(f.from, f.to) }));
  };

  it('reports definite mistakes under style-like kinds as likely errors', async () => {
    const all = await run('Better then nothing. I could of waited untill Friday, but I cant. Lets go..');
    const errors = all.filter((f) => f.cls === 'likely-error');
    expect(errors.map((f) => f.rule)).toEqual(
      expect.arrayContaining(['harper.ThenThan', 'harper.ModalOf', 'harper.WrongNegative', 'harper.Cant', 'harper.EllipsisLength']),
    );
    expect(errors.find((f) => f.rule === 'harper.WrongNegative')).toMatchObject({ cat: 'spelling', text: 'untill' });
    expect(errors.find((f) => f.rule === 'harper.ModalOf')).toMatchObject({ cat: 'word-choice', text: 'could of' });
  });

  it('keeps the raw engine unchanged for baselines', async () => {
    const raw = createNodeHarperEngine({ policy: false });
    await raw.setup();
    const snap = snapshotFromText('Better then nothing.');
    const f = (await raw.run(snap, {})).findings.find((x) => x.ruleId === 'harper.ThenThan');
    expect(f.classification).toBe('style');
  });

  it('turns off preference and expansion rules by default', async () => {
    const rules = (await run('We bought apples, pears and plums in 5 min, FYI.')).map((f) => f.rule);
    expect(rules).not.toContain('harper.OxfordComma');
    expect(rules).not.toContain('harper.ExpandMinimum');
    expect(rules).not.toContain('harper.ForYourInformation');
  });

  it('knows everyday technical words without a personal dictionary', async () => {
    const spelled = (await run('The wifi and bluetooth runbooks cover the retryable cron job.')).filter((f) => f.cat === 'spelling');
    expect(spelled).toEqual([]);
  });

  it('accepts chat shorthand only when the goal is casual', async () => {
    const text = 'can u send it bc i need it, y\'know';
    const spelled = async (goals) => (await run(text, { goals })).filter((f) => f.cat === 'spelling').map((f) => f.text);
    expect(await spelled({})).toEqual(expect.arrayContaining(['u', 'bc']));
    expect(await spelled({ formality: 'casual' })).toEqual([]);
  });
});
