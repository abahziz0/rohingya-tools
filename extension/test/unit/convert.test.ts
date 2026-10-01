import { describe, expect, it } from 'vitest';
import { hanifiToLatin } from '../../../converter/transliterate';
import { convertPieces, convertText } from '../../src/shared/convert';
import { containsHanifi, segmentHanifi } from '../../src/shared/hanifi';

const H = (...cps: number[]) => String.fromCodePoint(...cps);
// Engine-derived samples (NOT linguistically verified): built from code points.
const KA = 0x10d11, A = 0x10d00, VA = 0x10d1d, VO = 0x10d21, VI = 0x10d1e;
const HARBAHAY = 0x10d24, TAHALA = 0x10d25, TANA = 0x10d26, TASSI = 0x10d27, SAKIN = 0x10d22;
const NA = 0x10d15, MA = 0x10d14, LA = 0x10d13, BA = 0x10d01;

describe('Hanifi detection', () => {
  it('detects by code point only', () => {
    expect(containsHanifi(H(KA))).toBe(true);
    expect(containsHanifi('Rohingya ruáingga')).toBe(false);
    expect(containsHanifi('مرحبا বাংলা')).toBe(false);
    expect(containsHanifi(H(0x10d30))).toBe(true); // digit
    expect(containsHanifi(H(0x10d3f))).toBe(true); // block end (unassigned)
    expect(containsHanifi(H(0x10d40))).toBe(false); // next block (Garay)
  });

  it('segments into lossless runs', () => {
    const s = `Hi ${H(KA, VA)}, ${H(MA, VO)}!`;
    const segs = segmentHanifi(s);
    expect(segs.map(x => x.text).join('')).toBe(s);
    expect(segs.filter(x => x.hanifi).map(x => x.text)).toEqual([H(KA, VA), H(MA, VO)]);
  });
});

describe('convertText matches the shared engine', () => {
  it('equals hanifiToLatin output for random mixed strings', () => {
    const pool = [
      ...Array.from({ length: 0x40 }, (_, i) => H(0x10d00 + i)),
      'a', 'Z', ' ', '.', '،', '؟', '۔', 'م', 'ব', '😀', '‍', '‌', '5', '\n', 'é',
    ];
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let n = 0; n < 3000; n++) {
      const len = 1 + Math.floor(rand() * 12);
      const s = Array.from({ length: len }, () => pool[Math.floor(rand() * pool.length)]).join('');
      expect(convertText(s).output).toBe(hanifiToLatin(s).output);
    }
  });

  it('preserves non-Hanifi scripts, emoji and punctuation exactly', () => {
    const s = `English, العربية, বাংলা 😀 — ${H(KA, VA)} (x).`;
    const out = convertText(s).output;
    expect(out).toBe(`English, العربية, বাংলা 😀 — ${hanifiToLatin(H(KA, VA)).output} (x).`);
    expect(convertText(s).notes).toEqual([]); // no warnings for non-Hanifi text
  });

  it('handles tone marks as the engine does', () => {
    expect(convertText(H(KA, VA, HARBAHAY)).output).toBe(hanifiToLatin(H(KA, VA, HARBAHAY)).output);
    expect(convertText(H(KA, VA, TAHALA)).output).toBe(hanifiToLatin(H(KA, VA, TAHALA)).output);
    expect(convertText(H(KA, TASSI, VA)).output).toBe(hanifiToLatin(H(KA, TASSI, VA)).output);
    const tana = convertText(H(KA, VA, TANA));
    expect(tana.notes.map(n => n.warning)).toEqual(hanifiToLatin(H(KA, VA, TANA)).warnings);
    expect(tana.notes[0].original).toBe(H(KA, VA, TANA));
  });

  it('keeps unsupported Hanifi-block characters and reports them', () => {
    const unassigned = H(0x10d28);
    const r = convertText(`${H(KA, VA)}${unassigned}`);
    expect([...r.output]).toContain(unassigned);
    expect(r.notes.length).toBe(1);
    // Stray tone sign: the engine skips it but reports a warning.
    const stray = convertText(`x ${H(HARBAHAY)}`);
    expect(stray.notes.length).toBe(1);
    // Sakin: engine drops it by design (no Latin equivalent), without warning.
    expect(convertText(H(KA, SAKIN)).output).toBe(hanifiToLatin(H(KA, SAKIN)).output);
  });
});

describe('convertPieces (text split across elements)', () => {
  const joinedMatchesEngine = (pieces: string[]) => {
    const r = convertPieces(pieces);
    expect(r).not.toBeNull();
    expect(r!.pieces.map(p => p.output).join('')).toBe(hanifiToLatin(pieces.join('')).output);
    return r!;
  };

  it('keeps a tone sign in a separate element with its vowel', () => {
    const r = joinedMatchesEngine([H(KA, VA), H(HARBAHAY)]);
    expect(r.pieces[0].output).toBe(hanifiToLatin(H(KA, VA, HARBAHAY)).output);
    expect(r.pieces[1].output).toBe('');
  });

  it('keeps carrier letter A with a following vowel in another element', () => {
    joinedMatchesEngine([H(A), H(VI, NA)]);
  });

  it('handles tassi split from its consonant', () => {
    joinedMatchesEngine([`x ${H(LA)}`, H(TASSI, VA, BA)]);
  });

  it('splits plain word boundaries without moving text', () => {
    const r = joinedMatchesEngine([`${H(KA, VA)} `, H(MA, VO)]);
    expect(r.pieces[0].output).toBe(`${hanifiToLatin(H(KA, VA)).output} `);
  });

  it('matches the engine for random splits', () => {
    const pool = [KA, A, VA, VO, VI, HARBAHAY, TAHALA, TANA, TASSI, SAKIN, NA, 0x10d23, 0x10d30].map(c => H(c));
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    let nulls = 0;
    for (let n = 0; n < 3000; n++) {
      const pieces = Array.from({ length: 2 + Math.floor(rand() * 3) }, () =>
        Array.from({ length: Math.floor(rand() * 4) }, () => pool[Math.floor(rand() * pool.length)]).join(''));
      const r = convertPieces(pieces);
      if (!r) { nulls++; continue; } // unsafe: caller leaves source untouched
      expect(r.pieces.map(p => p.output).join('')).toBe(hanifiToLatin(pieces.join('')).output);
    }
    expect(nulls).toBeLessThan(300);
  });
});
