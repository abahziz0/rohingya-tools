/**
 * Page-text conversion built on the website's shared transliteration engine.
 *
 * The engine (converter/transliterate.ts) is the single source of
 * truth for every mapping. This module only decides *which* characters are
 * handed to it: maximal runs of Hanifi-block code points. Everything else
 * (English, Arabic, Bengali, emoji, punctuation, whitespace) is copied
 * through byte-for-byte, so no warnings are produced for non-Hanifi text.
 *
 * Because the engine passes non-Hanifi characters through unchanged, the
 * concatenated output of `convertText(s)` equals `hanifiToLatin(s).output`
 * for every string — this is asserted by the unit tests.
 */
import { hanifiToLatin } from '../../../converter/transliterate';
import { segmentHanifi } from './hanifi';

export interface OutputPart {
  text: string;
  /** True when this text was produced by the engine from Hanifi input. */
  converted: boolean;
}

export interface EngineNote {
  /** Warning text exactly as reported by the shared engine. */
  warning: string;
  /** The Hanifi run that produced the warning. */
  original: string;
  /** The engine's output for that run. */
  converted: string;
}

export interface PieceResult {
  parts: OutputPart[];
  output: string;
}

export interface ConversionResult {
  pieces: PieceResult[];
  notes: EngineNote[];
}

const engine = (chars: string[]) => hanifiToLatin(chars.join(''));

function collectNotes(notes: EngineNote[], warnings: string[], original: string, converted: string) {
  for (const warning of warnings) notes.push({ warning, original, converted });
}

/** Convert a single string. */
export function convertText(text: string): ConversionResult & { output: string } {
  const notes: EngineNote[] = [];
  const parts: OutputPart[] = [];
  for (const seg of segmentHanifi(text)) {
    if (!seg.hanifi) {
      parts.push({ text: seg.text, converted: false });
      continue;
    }
    const { output, warnings } = hanifiToLatin(seg.text);
    collectNotes(notes, warnings, seg.text, output);
    parts.push({ text: output, converted: true });
  }
  const output = parts.map(p => p.text).join('');
  return { pieces: [{ parts, output }], notes, output };
}

/**
 * Convert text that the page splits across several adjacent text nodes
 * (e.g. `𐴝<b>𐴤</b>`, a vowel whose tone sign sits in another element).
 *
 * Converting each node separately would change the result, because the
 * engine looks one code point ahead (carrier + vowel, vowel + tone sign,
 * consonant + tassi). Instead, each Hanifi run that crosses a node boundary
 * is converted as a whole, and the boundary is moved by at most two code
 * points to a place where splitting provably does not change the engine's
 * output. The engine itself is used as the oracle, so no mapping rules are
 * duplicated here.
 *
 * Returns null when no safe split exists; callers must then leave the
 * original text untouched.
 */
export function convertPieces(texts: string[]): ConversionResult | null {
  if (texts.length === 1) return convertText(texts[0]);

  const pieceChars = texts.map(t => [...t]);
  const starts: number[] = [];
  let offset = 0;
  for (const chars of pieceChars) {
    starts.push(offset);
    offset += chars.length;
  }
  const chars = pieceChars.flat();
  const pieceAt = (pos: number) => {
    let i = starts.length - 1;
    while (i > 0 && starts[i] > pos) i--;
    return i;
  };

  const parts: OutputPart[][] = texts.map(() => []);
  const notes: EngineNote[] = [];
  let pos = 0;

  for (const seg of segmentHanifi(texts.join(''))) {
    const segChars = [...seg.text];
    const segStart = pos;
    const segEnd = pos + segChars.length;
    pos = segEnd;

    if (!seg.hanifi) {
      // Non-Hanifi text is copied verbatim, split at the original boundaries.
      let from = segStart;
      while (from < segEnd) {
        const owner = pieceAt(from);
        const ownerEnd = owner + 1 < starts.length ? starts[owner + 1] : chars.length;
        const to = Math.min(segEnd, ownerEnd);
        parts[owner].push({ text: chars.slice(from, to).join(''), converted: false });
        from = to;
      }
      continue;
    }

    const whole = engine(segChars);
    collectNotes(notes, whole.warnings, seg.text, whole.output);

    // Original node boundaries strictly inside this run, relative to the run.
    const boundaries = starts.filter(s => s > segStart && s < segEnd).map(s => s - segStart);
    if (boundaries.length === 0) {
      parts[pieceAt(segStart)].push({ text: whole.output, converted: true });
      continue;
    }

    const cuts: number[] = [];
    let prev = 0;
    for (const b of boundaries) {
      let chosen = -1;
      for (const delta of [0, 1, 2, -1, -2]) {
        const cut = b + delta;
        if (cut < prev || cut > segChars.length) continue;
        const left = engine(segChars.slice(prev, cut)).output;
        const right = engine(segChars.slice(cut)).output;
        if (left + right === engine(segChars.slice(prev)).output) {
          chosen = cut;
          break;
        }
      }
      if (chosen < 0) return null;
      cuts.push(chosen);
      prev = chosen;
    }

    // Final proof: the pieces must reproduce the engine's output for the run.
    const bounds = [0, ...cuts, segChars.length];
    const outputs = bounds.slice(1).map((end, k) => engine(segChars.slice(bounds[k], end)).output);
    if (outputs.join('') !== whole.output) return null;

    outputs.forEach((text, k) => {
      // Sub-run k belongs to the node that started at original boundary k-1.
      const owner = k === 0 ? pieceAt(segStart) : pieceAt(segStart + boundaries[k - 1]);
      parts[owner].push({ text, converted: true });
    });
  }

  return {
    pieces: parts.map(p => ({ parts: p, output: p.map(x => x.text).join('') })),
    notes,
  };
}
