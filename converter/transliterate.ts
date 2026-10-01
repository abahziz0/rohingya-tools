/**
 * Rule-based Rohingyalish (Latin) ↔ Hanifi Rohingya transliteration.
 *
 * This is a beta, approximate engine: Hanifi is a true alphabet, so the
 * letter-level mapping is sound, but tone marking conventions vary between
 * writers. Conventions used here:
 *   - acute vowel (á í ú é ó)  ↔ vowel + SIGN HARBAHAY (U+10D24)
 *   - doubled vowel (aa ii …)  ↔ vowel + SIGN TAHALA (U+10D25)
 *   - doubled consonant (kk …) ↔ consonant + SIGN TASSI (U+10D27)
 *   - ñ (nasalisation)         ↔ MARK NA KHONNA (U+10D23)
 *   - word-initial vowels are written with the carrier LETTER A (U+10D00)
 * Unknown characters pass through unchanged and are reported as warnings.
 */

const L = {
  A: '\u{10D00}', BA: '\u{10D01}', PA: '\u{10D02}', TA: '\u{10D03}', TTA: '\u{10D04}',
  JA: '\u{10D05}', CA: '\u{10D06}', HA: '\u{10D07}', KHA: '\u{10D08}', FA: '\u{10D09}',
  DA: '\u{10D0A}', DDA: '\u{10D0B}', RA: '\u{10D0C}', RRA: '\u{10D0D}', ZA: '\u{10D0E}',
  SA: '\u{10D0F}', SHA: '\u{10D10}', KA: '\u{10D11}', GA: '\u{10D12}', LA: '\u{10D13}',
  MA: '\u{10D14}', NA: '\u{10D15}', WA: '\u{10D16}', KINNA_WA: '\u{10D17}', YA: '\u{10D18}',
  KINNA_YA: '\u{10D19}', NGA: '\u{10D1A}', NYA: '\u{10D1B}', VA: '\u{10D1C}',
  VOWEL_A: '\u{10D1D}', VOWEL_I: '\u{10D1E}', VOWEL_U: '\u{10D1F}', VOWEL_E: '\u{10D20}', VOWEL_O: '\u{10D21}',
  SAKIN: '\u{10D22}', NA_KHONNA: '\u{10D23}',
  HARBAHAY: '\u{10D24}', TAHALA: '\u{10D25}', TANA: '\u{10D26}', TASSI: '\u{10D27}',
};

// Rohingyalish dual consonants (h = thick, s = thin, ñ = nasal): dh th kh ch ts ñg ñy.
// 'ng'/'ny'/'sh' are kept as fallbacks for loose spellings; 'ts' approximated with TA.
const CONSONANTS: Record<string, string> = {
  kh: L.KHA, th: L.TTA, dh: L.DDA, ch: L.SHA, ts: L.TA,
  'ñg': L.NGA, 'ñy': L.NYA,
  ng: L.NGA, ny: L.NYA, sh: L.SHA,
  b: L.BA, p: L.PA, t: L.TA, j: L.JA, c: L.CA, h: L.HA, f: L.FA, d: L.DA,
  r: L.RA, 'ç': L.RRA, z: L.ZA, s: L.SA, k: L.KA, g: L.GA, l: L.LA, m: L.MA,
  n: L.NA, w: L.WA, y: L.YA, v: L.VA,
};

const VOWELS: Record<string, string> = {
  a: L.VOWEL_A, i: L.VOWEL_I, u: L.VOWEL_U, e: L.VOWEL_E, o: L.VOWEL_O,
};

const ACCENTED: Record<string, string> = { 'á': 'a', 'í': 'i', 'ú': 'u', 'é': 'e', 'ó': 'o' };

const LATIN_DIGITS_TO_HANIFI: Record<string, string> = Object.fromEntries(
  Array.from({ length: 10 }, (_, i) => [String(i), String.fromCodePoint(0x10d30 + i)])
);

// Longest patterns first so digraphs win over single letters.
const CONSONANT_KEYS = Object.keys(CONSONANTS).sort((a, b) => b.length - a.length);

export interface TransliterationResult {
  output: string;
  warnings: string[];
}

const cpLabel = (ch: string) => `“${ch}” (U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')})`;

export function latinToHanifi(input: string): TransliterationResult {
  const text = input.normalize('NFC').toLowerCase();
  const warnings = new Set<string>();
  let out = '';
  let atWordStart = true;
  let i = 0;

  const emitVowel = (vowel: string, tone: '' | typeof L.HARBAHAY | typeof L.TAHALA) => {
    if (atWordStart) out += L.A; // vowel carrier at the start of a word
    out += VOWELS[vowel] + tone;
    atWordStart = false;
  };

  while (i < text.length) {
    const ch = text[i];

    // Accented vowel → vowel + harbahay
    if (ACCENTED[ch]) {
      emitVowel(ACCENTED[ch], L.HARBAHAY);
      i += 1;
      continue;
    }

    // Doubled vowel (aa, ii…) → vowel + tahala
    if (VOWELS[ch]) {
      if (text[i + 1] === ch) {
        emitVowel(ch, L.TAHALA);
        i += 2;
      } else {
        emitVowel(ch, '');
        i += 1;
      }
      continue;
    }

    // Consonants: digraphs first (incl. ñg/ñy), then doubled consonant → tassi
    const match = CONSONANT_KEYS.find(k => text.startsWith(k, i));
    if (!match && ch === 'ñ') {
      // standalone nasalisation mark
      out += L.NA_KHONNA;
      atWordStart = false;
      i += 1;
      continue;
    }
    if (match) {
      out += CONSONANTS[match];
      i += match.length;
      if (match.length === 1 && text[i] === match) {
        out += L.TASSI; // gemination, e.g. "kk"
        i += 1;
      }
      atWordStart = false;
      continue;
    }

    if (LATIN_DIGITS_TO_HANIFI[ch]) {
      out += LATIN_DIGITS_TO_HANIFI[ch];
      atWordStart = false;
      i += 1;
      continue;
    }

    // Whitespace & common punctuation pass through and reset word state
    if (/[\s.,;:!?'"()\-–—\/]/.test(ch)) {
      out += ch;
      atWordStart = true;
      i += 1;
      continue;
    }

    // Unknown character: keep it, warn once
    out += ch;
    warnings.add(cpLabel(ch));
    atWordStart = false;
    i += 1;
  }

  return { output: out, warnings: [...warnings] };
}

const HANIFI_TO_LATIN: Record<number, string> = {
  0x10d00: 'a', 0x10d01: 'b', 0x10d02: 'p', 0x10d03: 't', 0x10d04: 'th',
  0x10d05: 'j', 0x10d06: 'c', 0x10d07: 'h', 0x10d08: 'kh', 0x10d09: 'f',
  0x10d0a: 'd', 0x10d0b: 'dh', 0x10d0c: 'r', 0x10d0d: 'ç', 0x10d0e: 'z',
  0x10d0f: 's', 0x10d10: 'ch', 0x10d11: 'k', 0x10d12: 'g', 0x10d13: 'l',
  0x10d14: 'm', 0x10d15: 'n', 0x10d16: 'w', 0x10d17: 'w', 0x10d18: 'y',
  0x10d19: 'y', 0x10d1a: 'ñg', 0x10d1b: 'ñy', 0x10d1c: 'v',
  0x10d1d: 'a', 0x10d1e: 'i', 0x10d1f: 'u', 0x10d20: 'e', 0x10d21: 'o',
  0x10d23: 'ñ',
};

const VOWEL_TO_ACCENTED: Record<string, string> = { a: 'á', i: 'í', u: 'ú', e: 'é', o: 'ó' };
const VOWEL_CPS = new Set([0x10d1d, 0x10d1e, 0x10d1f, 0x10d20, 0x10d21]);
const CARRIER_A = 0x10d00;

export function hanifiToLatin(input: string): TransliterationResult {
  const warnings = new Set<string>();
  const cps = [...input].map(ch => ch.codePointAt(0)!);
  let out = '';
  let i = 0;

  while (i < cps.length) {
    const cp = cps[i];

    // Carrier A before a vowel letter is silent in Latin
    if (cp === CARRIER_A && VOWEL_CPS.has(cps[i + 1])) {
      i += 1;
      continue;
    }

    // Hanifi digits
    if (cp >= 0x10d30 && cp <= 0x10d39) {
      out += String(cp - 0x10d30);
      i += 1;
      continue;
    }

    // Sakin (vowel killer) has no Latin equivalent
    if (cp === 0x10d22) {
      i += 1;
      continue;
    }

    const latin = HANIFI_TO_LATIN[cp];
    if (latin !== undefined) {
      const next = cps[i + 1];
      if (VOWEL_CPS.has(cp) && next === 0x10d24) {
        out += VOWEL_TO_ACCENTED[latin]; // harbahay → acute accent
        i += 2;
        continue;
      }
      if (VOWEL_CPS.has(cp) && next === 0x10d25) {
        out += latin + latin; // tahala → long (doubled) vowel
        i += 2;
        continue;
      }
      if (VOWEL_CPS.has(cp) && next === 0x10d26) {
        out += VOWEL_TO_ACCENTED[latin]; // tana: approximated with acute
        warnings.add('Tone sign tana (U+10D26) approximated with an acute accent');
        i += 2;
        continue;
      }
      if (next === 0x10d27) {
        out += latin + latin; // tassi → doubled consonant
        i += 2;
        continue;
      }
      out += latin;
      i += 1;
      continue;
    }

    // Stray tone marks (no preceding letter handled above)
    if (cp >= 0x10d24 && cp <= 0x10d27) {
      warnings.add(`Tone sign U+${cp.toString(16).toUpperCase()} without a base letter was skipped`);
      i += 1;
      continue;
    }

    const ch = String.fromCodePoint(cp);
    out += ch;
    if (!/[\s.,;:!?'"()\-–—\/0-9a-z]/i.test(ch)) warnings.add(cpLabel(ch));
    i += 1;
  }

  return { output: out, warnings: [...warnings] };
}
