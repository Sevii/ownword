// Score an analysis envelope against a prepared case.
//
// A detection matches an expected issue when it is in the same block and the
// ranges overlap. "Strict" also requires the same category. Each expected
// issue matches at most once, so duplicate detections cannot inflate recall.
// Correction metrics use likely-error detections only; style findings are
// reported separately so they cannot hide correction noise.

import { countWords } from '../../frontend/src/analysis/text/segment.js';

const overlaps = (a, b) => a.blockId === b.blockId && a.from < b.to && b.from < a.to;

/**
 * @param {ReturnType<typeof import('./cases.js').prepareCase>} prepared
 * @param {import('./cases.js').EvalCase} c
 * @param {import('../../frontend/src/analysis/types.js').Envelope} envelope
 */
export function scoreCase(prepared, c, envelope) {
  const { snapshot, expected, optional } = prepared;
  const errors = envelope.findings.filter((f) => f.classification === 'likely-error' && f.anchor);
  const style = envelope.findings.filter((f) => f.classification !== 'likely-error' && f.anchor);
  const expectedErrors = expected.filter((e) => e.classification === 'likely-error');
  const expectedStyle = expected.filter((e) => e.classification !== 'likely-error');

  const matchSet = (detections, targets, strict) => {
    const used = new Set();
    const matched = [];
    for (const d of detections) {
      const i = targets.findIndex((t, k) => !used.has(k) && overlaps(d.anchor, t.anchor) && (!strict || t.category === d.category));
      if (i >= 0) {
        used.add(i);
        matched.push([d, targets[i]]);
      }
    }
    return { matched, used };
  };

  const lenient = matchSet(errors, expectedErrors, false);
  const strict = matchSet(errors, expectedErrors, true);
  const matchedDetections = new Set(lenient.matched.map(([d]) => d));
  // Detections on spans annotated as acceptable observations are not false positives.
  const unmatched = errors.filter((d) => !matchedDetections.has(d));
  const onOptional = unmatched.filter((d) => [...optional, ...expectedStyle].some((o) => overlaps(d.anchor, o.anchor)));
  const falsePositives = unmatched.filter((d) => !onOptional.includes(d));

  // A fix is correct when applying it gives the same block text as applying
  // an accepted replacement to the annotated span, so "to"→"too" satisfies an
  // annotation of "to few"→"too few".
  const correctFixes = lenient.matched.filter(([d, e]) => {
    if (!e.accept?.length) return false;
    const text = snapshot.blocks.find((b) => b.id === e.anchor.blockId)?.text ?? '';
    const apply = (a, t) => text.slice(0, a.from) + t + text.slice(a.to);
    const wanted = new Set(e.accept.map((t) => apply(e.anchor, t)));
    return d.replacements.some((r) => wanted.has(apply(d.anchor, r.text)));
  });
  const fixable = lenient.matched.filter(([, e]) => e.accept?.length);

  const forbiddenTouched = errors
    .concat(style)
    .filter((d) => d.replacements.length)
    .filter((d) => {
      const block = snapshot.blocks.find((b) => b.id === d.anchor.blockId);
      return c.forbiddenChanges.some((f) => {
        for (let i = block.text.indexOf(f); i >= 0; i = block.text.indexOf(f, i + 1)) {
          if (d.anchor.from < i + f.length && i < d.anchor.to) return true;
        }
        return false;
      });
    });

  const styleMatched = matchSet(style, [...expectedStyle, ...optional], false);

  const missed = expectedErrors.filter((_, i) => !lenient.used.has(i));
  const words = snapshot.blocks.filter((b) => b.type !== 'codeBlock').reduce((n, b) => n + countWords(b.text), 0);

  return {
    id: c.id,
    clean: c.clean,
    words,
    detections: errors.length,
    expected: expectedErrors.length,
    matchedLenient: lenient.matched.length,
    matchedStrict: strict.matched.length,
    truePositives: lenient.matched.map(([d]) => describe(snapshot)(d)),
    falsePositives: falsePositives.map(describe(snapshot)),
    missed: missed.map((e) => ({ category: e.category, quote: e.quote })),
    perCategory: perCategory(expectedErrors, lenient.used, errors, falsePositives),
    fixable: fixable.length,
    correctFixes: correctFixes.length,
    forbiddenTouched: forbiddenTouched.map(describe(snapshot)),
    style: { detections: style.length, onAnnotated: styleMatched.matched.length },
    rejected: envelope.rejectedFindingCount,
  };
}

const describe = (snapshot) => (d) => ({
  rule: d.origin.ruleId,
  category: d.category,
  text: snapshot.blocks.find((b) => b.id === d.anchor.blockId).text.slice(d.anchor.from, d.anchor.to),
  replacements: d.replacements.map((r) => r.text),
});

function perCategory(expectedErrors, usedIdx, errors, falsePositives) {
  const out = {};
  const bump = (cat, key) => {
    out[cat] ??= { expected: 0, found: 0, detections: 0, falsePositives: 0 };
    out[cat][key]++;
  };
  expectedErrors.forEach((e, i) => {
    bump(e.category, 'expected');
    if (usedIdx.has(i)) bump(e.category, 'found');
  });
  for (const d of errors) bump(d.category, 'detections');
  for (const d of falsePositives) bump(d.category, 'falsePositives');
  return out;
}

/** @param {ReturnType<typeof scoreCase>[]} results */
export function aggregate(results) {
  const sum = (f) => results.reduce((n, r) => n + f(r), 0);
  const detections = sum((r) => r.detections);
  const fps = sum((r) => r.falsePositives.length);
  const expected = sum((r) => r.expected);
  const cleanWords = sum((r) => (r.clean ? r.words : 0));
  const cleanFps = sum((r) => (r.clean ? r.falsePositives.length : 0));
  const categories = {};
  for (const r of results) {
    for (const [cat, v] of Object.entries(r.perCategory)) {
      categories[cat] ??= { expected: 0, found: 0, detections: 0, falsePositives: 0 };
      for (const k of Object.keys(v)) categories[cat][k] += v[k];
    }
  }
  for (const v of Object.values(categories)) {
    v.recall = v.expected ? v.found / v.expected : null;
    v.precision = v.detections ? (v.detections - v.falsePositives) / v.detections : null;
  }
  const ratio = (a, b) => (b ? a / b : null);
  return {
    cases: results.length,
    cleanCases: results.filter((r) => r.clean).length,
    words: sum((r) => r.words),
    correction: {
      detections,
      falsePositives: fps,
      precision: ratio(detections - fps, detections),
      expected,
      foundLenient: sum((r) => r.matchedLenient),
      foundStrict: sum((r) => r.matchedStrict),
      recallLenient: ratio(sum((r) => r.matchedLenient), expected),
      recallStrict: ratio(sum((r) => r.matchedStrict), expected),
      fixAccuracy: ratio(sum((r) => r.correctFixes), sum((r) => r.fixable)),
    },
    cleanText: { words: cleanWords, falsePositives: cleanFps, perThousandWords: ratio(cleanFps * 1000, cleanWords) },
    forbiddenTouched: sum((r) => r.forbiddenTouched.length),
    style: { detections: sum((r) => r.style.detections), onAnnotated: sum((r) => r.style.onAnnotated) },
    rejectedAnchors: sum((r) => r.rejected),
    categories,
  };
}
