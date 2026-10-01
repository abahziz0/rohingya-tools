# Hanifi Rohingya ↔ Rohingyalish Script Converter

A dependency-free, rule-based TypeScript library for converting between Hanifi
Rohingya Unicode and Rohingyalish, the Latin-based Rohingya writing system.
Maintained by [RohingyaLanguage.org](https://rohingyalanguage.org/).

[Use the online converter](https://rohingyalanguage.org/tools/script-converter/)
or build this library for your own application.

## Build and use

From the repository root:

```sh
npm ci
npm run build --workspace converter
```

```js
import { latinToHanifi, hanifiToLatin } from './converter/dist/index.js';

const converted = latinToHanifi('kitab');
const restored = hanifiToLatin(converted.output);
console.log(converted.output, restored.output);
```

The package also provides generated TypeScript declarations in `dist/`.
Within this repository's npm workspaces, use the package import
`@abahziz0/rohingya-converter` after building. The package is not currently
published to the npm registry.

## API

| Function | Input | Return value |
| --- | --- | --- |
| `latinToHanifi(input)` | Rohingyalish string | `{ output: string, warnings: string[] }` |
| `hanifiToLatin(input)` | Hanifi Rohingya string | `{ output: string, warnings: string[] }` |

The engine processes Unicode Hanifi letters, supported marks, and digits in
U+10D00–U+10D3F. Rohingyalish input is normalized to NFC and lowercased.
Unsupported characters and ambiguous cases follow the engine's documented
behavior; inspect `warnings` before treating an output as final.

## Accuracy

Conversion is approximate and does not translate between languages. Tone and
orthographic conventions may differ between writers, and some distinctions do
not round-trip. Read [the implementation](transliterate.ts),
[known limitations](../extension/docs/limitations.md), and
[example review instructions](transliteration-examples.md).

The extension's unit suite tests this engine and its integration with webpage
conversion. Run `npm test` from the repository root. Examples marked
`engine-snapshot` record existing behavior; they are not reviewed linguistic
evidence.

Code: MIT. See the repository's [LICENSE](../LICENSE).
