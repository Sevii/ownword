# Eval report: harper+rules

2026-10-29T14:48:54.728Z · split `dev` · engines harper, rules · 9207 ms

Versions: harness 1, harper 2.13.0, rules 1, corpus 6615abc74dc5

## Summary

| Measure | Value | Raw |
| --- | --- | --- |
| Correction precision | 78.3% | 83 / 106 |
| Recall (overlap) | 59.0% | 82 / 139 |
| Recall (overlap + category) | 46.0% | 64 / 139 |
| Fix accuracy | 98.8% | of matched issues with accepted fixes |
| Clean-text false positives | 5.05 per 1k words | 10 in 1982 words |
| Forbidden spans touched by a replacement | 8 | |
| Style observations | 192 | 6 on annotated spans |
| Rejected anchors | 0 | |

Cases: 119 (30 clean), 8233 words.

## By category (likely errors)

| Category | Expected | Found | Recall | Detections | False positives | Precision |
| --- | --- | --- | --- | --- | --- | --- |
| capitalization | 10 | 9 | 90.0% | 4 | 0 | 100.0% |
| grammar | 35 | 10 | 28.6% | 10 | 1 | 90.0% |
| punctuation | 15 | 7 | 46.7% | 2 | 0 | 100.0% |
| repetition | 11 | 11 | 100.0% | 12 | 1 | 91.7% |
| spelling | 46 | 43 | 93.5% | 77 | 20 | 74.0% |
| word-choice | 22 | 2 | 9.1% | 1 | 1 | 0.0% |

## False positives

- `clean-0040` harper.SpellCheck (spelling): “y'know” → “know”
- `clean-0077` harper.SpellCheck (spelling): “travelled” → “traveled”, “travailed”, “traveler”
- `clean-0077` harper.SpellCheck (spelling): “travelled” → “traveled”, “travailed”, “traveler”
- `clean-0091` harper.SpellCheck (spelling): “Ashcombe” → “Ashore”, “Ascribe”
- `clean-0091` harper.SpellCheck (spelling): “hirers” → “hire's”, “hiders”, “hikers”
- `clean-0091` harper.SpellCheck (spelling): “hirers” → “hire's”, “hiders”, “hikers”
- `clean-0091` harper.SpellCheck (spelling): “Hirers” → “Hire's”, “Hiders”, “Hikers”
- `clean-0099` harper.SpellCheck (spelling): “u” → “uh”, “um”, “up”
- `clean-0099` harper.SpellCheck (spelling): “bc” → “be”, “bi”, “bk”
- `clean-0104` harper.OneOfTheSingular (word-choice): “team” → “teams”
- `doc-0064` harper.SpellCheck (spelling): “Hana” → “Hand”, “Hang”, “Hank”
- `doc-0088` harper.SpellCheck (spelling): “retryable” → “repayable”, “returnable”
- `doc-0088` harper.SpellCheck (spelling): “retryable” → “repayable”, “returnable”
- `doc-0088` harper.SpellCheck (spelling): “retryable” → “repayable”, “returnable”
- `email-0005` harper.SpellCheck (spelling): “Jen” → “Jean”, “Jet”, “Jun”
- `email-0011` harper.SpellCheck (spelling): “chaperones” → “chaperon's”, “chaperons”, “chaperon”
- `email-0024` harper.SpellCheck (spelling): “bluetooth” → “Bluetooth”
- `email-0115` harper.SpellCheck (spelling): “Hendersons” → “Henderson's”, “Henderson”
- `email-0116` harper.RepeatedWords (repetition): “Kim Kim” → “Kim”
- `essay-0090` harper.SpellCheck (spelling): “runbooks” → “rulebooks”, “unhooks”
- `msg-0047` harper.SpellCheck (spelling): “wifi” → “wife”, “wiki”, “wadi”
- `msg-0048` harper.SpellCheck (spelling): “Ok” → “Oak”, “Of”, “Oh”
- `post-0089` harper.PronounVerbAgreement (grammar): “hid” → “hides”

## Missed

- `doc-0065`: “there” (grammar)
- `doc-0068`: “effected” (word-choice)
- `doc-0087`: “there” (grammar), “then” (word-choice), “30 days notice” (punctuation)
- `doc-0088`: “then” (word-choice), “would of” (word-choice)
- `email-0003`: “Its” (grammar), “there” (grammar)
- `email-0005`: “to” (word-choice)
- `email-0010`: “could of” (word-choice)
- `email-0011`: “your” (grammar)
- `email-0012`: “then” (word-choice), “effect” (word-choice)
- `email-0013`: “come” (grammar)
- `email-0018`: “untill” (spelling)
- `email-0021`: “untill” (spelling)
- `email-0025`: “except” (word-choice)
- `email-0026`: “cant” (punctuation)
- `email-0027`: “samples..” (punctuation)
- `email-0028`: “customers” (punctuation)
- `email-0029`: “finished, the” (punctuation)
- `email-0030`: “you're” (grammar)
- `email-0032`: “you're” (grammar), “there” (grammar)
- `email-0035`: “should of” (word-choice)
- `email-0093`: “you're” (grammar)
- `email-0094`: “has” (grammar)
- `email-0097`: “its” (grammar)
- `email-0101`: “you're” (grammar)
- `email-0107`: “you're” (grammar)
- `email-0110`: “messy..” (punctuation)
- `email-0113`: “it” (capitalization)
- `essay-0076`: “then” (word-choice), “then” (word-choice), “there” (grammar)
- `essay-0079`: “Its” (grammar)
- `essay-0090`: “are” (grammar), “it's” (grammar)
- `essay-0114`: “then” (word-choice), “then” (word-choice)
- `msg-0042`: “Your” (grammar), “your” (grammar)
- `msg-0045`: “could of” (word-choice)
- `msg-0047`: “Its” (grammar)
- `msg-0049`: “you're” (grammar)
- `post-0052`: “then” (word-choice), “to” (word-choice)
- `post-0054`: “it's” (grammar), “couldn't of” (word-choice)
- `post-0057`: “you're” (grammar)
- `post-0060`: “Lets” (punctuation)
- `post-0061`: “then” (word-choice)
- `post-0089`: “untill” (spelling), “then” (word-choice)
- `post-0103`: “you're” (grammar)
- `post-0108`: “available, just” (punctuation)

## Forbidden spans touched

- `clean-0040` harper.SpellCheck: “y'know” → know
- `clean-0041` harper.ExpandMinimum: “min” → minimum
- `clean-0099` harper.SpellCheck: “u” → uh, um, up
- `clean-0099` harper.SpellCheck: “bc” → be, bi, bk
- `email-0022` harper.NumericRangeEnDash: “-” → –
- `email-0115` harper.SpellCheck: “Hendersons” → Henderson's, Henderson
- `email-0116` harper.RepeatedWords: “Kim Kim” → Kim
- `post-0058` harper.ExpandMemoryShorthands: “B” →  bytes
