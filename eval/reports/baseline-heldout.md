# Eval report: harper+rules

2026-10-29T14:49:16.130Z · split `heldout` · engines harper, rules · 3394 ms

Versions: harness 1, harper 2.13.0, rules 1, corpus 661a5a08dcf9

## Summary

| Measure | Value | Raw |
| --- | --- | --- |
| Correction precision | 81.3% | 26 / 32 |
| Recall (overlap) | 57.8% | 26 / 45 |
| Recall (overlap + category) | 44.4% | 20 / 45 |
| Fix accuracy | 96.2% | of matched issues with accepted fixes |
| Clean-text false positives | 7.97 per 1k words | 4 in 502 words |
| Forbidden spans touched by a replacement | 6 | |
| Style observations | 54 | 0 on annotated spans |
| Rejected anchors | 0 | |

Cases: 39 (10 clean), 2703 words.

## By category (likely errors)

| Category | Expected | Found | Recall | Detections | False positives | Precision |
| --- | --- | --- | --- | --- | --- | --- |
| capitalization | 3 | 3 | 100.0% | 4 | 3 | 25.0% |
| grammar | 13 | 6 | 46.2% | 4 | 0 | 100.0% |
| punctuation | 5 | 2 | 40.0% | 2 | 0 | 100.0% |
| repetition | 3 | 3 | 100.0% | 3 | 0 | 100.0% |
| spelling | 14 | 12 | 85.7% | 19 | 3 | 84.2% |
| word-choice | 7 | 0 | 0.0% | 0 | 0 | n/a |

## False positives

- `clean-0131` harper.SentenceCapitalization (capitalization): “omw” → “Omw”
- `clean-0131` harper.SentenceCapitalization (capitalization): “gonna” → “Gonna”
- `clean-0131` harper.SentenceCapitalization (capitalization): “save” → “Save”
- `clean-0135` harper.SpellCheck (spelling): “bc” → “be”, “bi”, “bk”
- `email-0146` harper.SpellCheck (spelling): “bloodwork” → “woodwork”
- `essay-0143` harper.NotTo (spelling): “no to” → “not to”

## Missed

- `doc-0141`: “untill” (spelling)
- `doc-0151`: “you're” (grammar), “then” (word-choice), “there” (grammar), “then” (word-choice)
- `email-0120`: “to” (word-choice)
- `email-0122`: “Wendsday” (spelling)
- `email-0124`: “have” (grammar)
- `email-0129`: “too” (word-choice)
- `email-0145`: “you're” (grammar)
- `email-0146`: “too” (word-choice)
- `email-0149`: “done, I” (punctuation)
- `email-0153`: “then” (word-choice)
- `email-0154`: “is” (grammar)
- `email-0157`: “was” (grammar)
- `essay-0143`: “your” (grammar)
- `msg-0134`: “wont” (punctuation)
- `post-0136`: “then” (word-choice)
- `post-0152`: “friends” (punctuation)

## Forbidden spans touched

- `clean-0131` harper.SentenceCapitalization: “omw” → Omw
- `clean-0131` harper.SentenceCapitalization: “gonna” → Gonna
- `clean-0131` harper.ExpandMinimum: “min” → minimum
- `clean-0135` harper.SpellCheck: “bc” → be, bi, bk
- `clean-0150` harper.NumericRangeEnDash: “-” → –
- `email-0155` harper.NumericRangeEnDash: “-” → –
