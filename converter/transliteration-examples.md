# Transliteration examples

`transliteration-examples.json` holds examples for the rule-based converter in
`converter/transliterate.ts`. The online script converter and the
Rohingya Reader browser extension both use that converter, so an example
checked here applies to both.

## Two kinds of correctness

- **Technical correctness**: text is detected, converted, displayed and
  restored as intended. The extension's automated tests check this.
- **Linguistic correctness**: the Rohingyalish output is the spelling a fluent
  reader intends. Only reviewed examples (`"status": "verified"`) can show this.

A round trip from Rohingyalish to Hanifi and back to Rohingyalish proves
nothing about accuracy. Most snapshot entries were generated exactly that way
from dictionary spellings, so they only record current behaviour.

## Statuses

| status | meaning | checked by tests |
| --- | --- | --- |
| `verified` | Reviewed by at least two people who read both Hanifi and Rohingyalish. `rohingyalish` is the intended spelling. | Engine output must match, unless `engineKnownDifference` is `true`. |
| `needs-review` | Proposed example that no one has reviewed yet. | Format only. |
| `engine-snapshot` | What the engine outputs today. **Not verified.** | Output and warnings must stay the same, so unintended engine changes get noticed. |

## Entry format

```json
{
  "id": "ver-0001",
  "hanifi": "…Hanifi text as written by a Hanifi writer…",
  "rohingyalish": "…intended Rohingyalish spelling…",
  "status": "verified",
  "source": "Where the Hanifi text came from (publication, writer, date)",
  "review": {
    "reviewers": [
      { "name": "Reviewer name or initials", "reads": ["hanifi", "rohingyalish"] },
      { "name": "Second reviewer", "reads": ["hanifi", "rohingyalish"] }
    ],
    "date": "2026-10-01"
  },
  "engineKnownDifference": false,
  "notes": "Optional: why this example matters (tone sign, dialect variation, …)"
}
```

- Use Hanifi that a person wrote. Don't use output from this converter.
- If the engine gets a verified example wrong, keep the example, set
  `"engineKnownDifference": true`, and describe the issue in `notes`. The test
  fails once the engine starts producing the reviewed spelling, which is the
  reminder to remove the flag.
- Only change engine mappings when verified examples support the change. Then
  refresh the snapshots from the `extension/` directory with
  `npm run examples:snapshot` and review the diff.

## Current engine behaviour worth reviewing

The snapshots record these conventions. None of them has been verified:

- Tone sign **tana** (U+10D26) is shown with an acute accent, like harbahay,
  and the engine reports a warning.
- **Sakin** (U+10D22) is dropped because it has no Latin equivalent.
- **Kinna wa / kinna ya** (U+10D17 / U+10D19) become `w` / `y`, the same as
  wa / ya.
- A carrier **letter A** before a vowel is silent. On its own it is written `a`.
- Hanifi → Latin never produces `ts`, `sh`, `ng` or `ny`. Letter TA is always
  `t`, SHA is always `ch`, and NGA / NYA are always `ñg` / `ñy`. Some spellings do not round-trip
  for this reason (for example `tsáni`, `hashormo`, `fúngri`).
- Arabic punctuation used with Hanifi (، ؛ ؟ ۔) is left unchanged.
