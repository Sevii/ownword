# Eval report: harper+rules

2026-10-29T16:18:45.786Z · split `heldout` · engines harper, rules · 3895 ms

Versions: harness 2, harper 2.13.0, rules 2, corpus e3d51b094c24

## Summary

| Measure | Value | Raw |
| --- | --- | --- |
| Correction precision | 83.8% | 83 / 99 |
| Recall (overlap) | 74.1% | 83 / 112 |
| Recall (overlap + category) | 65.2% | 73 / 112 |
| Fix accuracy | 96.4% | of matched issues with accepted fixes |
| Clean-text false positives | 2.94 per 1k words | 8 in 2721 words |
| Forbidden spans touched by a replacement | 7 | |
| Style observations | 171 | 16 on annotated spans |
| Rejected anchors | 0 | |

Cases: 99 (33 clean), 7750 words.

## By category (likely errors)

| Category | Expected | Found | Recall | Detections | False positives | Precision |
| --- | --- | --- | --- | --- | --- | --- |
| capitalization | 6 | 6 | 100.0% | 7 | 3 | 57.1% |
| grammar | 41 | 23 | 56.1% | 20 | 0 | 100.0% |
| punctuation | 8 | 4 | 50.0% | 3 | 1 | 66.7% |
| repetition | 8 | 8 | 100.0% | 8 | 0 | 100.0% |
| spelling | 29 | 28 | 96.6% | 47 | 12 | 74.5% |
| word-choice | 20 | 14 | 70.0% | 14 | 0 | 100.0% |

## False positives

- `clean-0131` harper.SentenceCapitalization (capitalization): “omw” → “Omw”
- `clean-0131` harper.SentenceCapitalization (capitalization): “gonna” → “Gonna”
- `clean-0131` harper.SentenceCapitalization (capitalization): “save” → “Save”
- `clean-0135` harper.SpellCheck (spelling): “bc” → “be”, “bi”, “bk”
- `doc-2001` harper.SpellCheck (spelling): “systemctl” → “system's”, “systemd's”, “systemic's”
- `doc-3004` harper.SpellCheck (spelling): “rata” → “rat”, “rate”, “rota”
- `doc-3011` harper.SpellCheck (spelling): “afterwards” → “afterwords”, “afterward”, “afterword's”
- `email-0146` harper.SpellCheck (spelling): “bloodwork” → “woodwork”
- `email-2002` harper.SpellCheck (spelling): “Priya” → “Pica”, “Pray”, “Prey”
- `email-2025` harper.WellBeing (punctuation): “wellbeing” → “well-being”
- `email-2026` harper.SpellCheck (spelling): “eng” → “egg”, “end”, “erg”
- `essay-0143` harper.NotTo (spelling): “no to” → “not to”
- `essay-2002` harper.SpellCheck (spelling): “endosymbiotic” → “symbiotic”
- `msg-2013` harper.SpellCheck (spelling): “bouldering” → “blundering”, “boltering”, “bordering”
- `post-2010` harper.SpellCheck (spelling): “microchipped” → “microchip's”, “microchip”, “microchips”
- `post-2030` harper.SpellCheck (spelling): “etc” → “eta”, “etc.”, “enc”

## Missed

- `doc-0151`: “then” (word-choice), “then” (word-choice)
- `doc-2001`: “logs shows” (grammar)
- `doc-2007`: “tickets have” (grammar)
- `doc-3031`: “linter handle” (grammar)
- `email-0120`: “to” (word-choice)
- `email-0122`: “Wendsday” (spelling)
- `email-0124`: “have” (grammar)
- `email-0149`: “done, I” (punctuation)
- `email-0154`: “is” (grammar)
- `email-0157`: “was” (grammar)
- `email-2002`: “team have” (grammar)
- `email-2026`: “there” (grammar)
- `essay-2021`: “your embarrassed” (grammar)
- `essay-2026`: “principal” (word-choice), “work they” (punctuation)
- `essay-2027`: “less thin bags” (word-choice)
- `essay-2034`: “Science says” (grammar)
- `msg-0134`: “wont” (punctuation)
- `msg-2006`: “their way” (grammar), “to early” (word-choice)
- `msg-2013`: “its way” (grammar)
- `msg-2017`: “your having” (grammar)
- `post-0152`: “friends” (punctuation)
- `post-2007`: “and its honestly” (grammar), “there regular” (grammar)
- `post-2010`: “you're garages” (grammar)
- `post-2014`: “out their” (grammar)
- `post-2016`: “your driving” (grammar)

## Forbidden spans touched

- `clean-0131` harper.SentenceCapitalization: “omw” → Omw
- `clean-0131` harper.SentenceCapitalization: “gonna” → Gonna
- `clean-0135` harper.SpellCheck: “bc” → be, bi, bk
- `doc-2001` harper.SpellCheck: “systemctl” → system's, systemd's, systemic's
- `email-2002` harper.SpellCheck: “Priya” → Pica, Pray, Prey
- `email-2026` harper.SpellCheck: “eng” → egg, end, erg
- `post-2030` harper.SpellCheck: “etc” → eta, etc., enc
