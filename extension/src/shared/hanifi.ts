/**
 * Hanifi Rohingya detection, based only on Unicode code points
 * (block U+10D00–U+10D3F), never on lang attributes, fonts or appearance.
 */

export const HANIFI_FIRST = 0x10d00;
export const HANIFI_LAST = 0x10d3f;

/** True if the string contains at least one code point in the Hanifi block. */
export const HANIFI_TEST = /[\u{10D00}-\u{10D3F}]/u;

export const containsHanifi = (text: string): boolean => HANIFI_TEST.test(text);

export const isHanifiCodePoint = (cp: number | undefined): boolean =>
  cp !== undefined && cp >= HANIFI_FIRST && cp <= HANIFI_LAST;

/** First / last code point of a string (surrogate-pair aware). */
export const firstCodePoint = (text: string): number | undefined => text.codePointAt(0);

export function lastCodePoint(text: string): number | undefined {
  if (!text) return undefined;
  const last = text.charCodeAt(text.length - 1);
  // Low surrogate: step back one more UTF-16 unit to read the full code point.
  if (last >= 0xdc00 && last <= 0xdfff && text.length >= 2) return text.codePointAt(text.length - 2);
  return last;
}

export interface Segment {
  text: string;
  /** True for a maximal run of Hanifi-block code points. */
  hanifi: boolean;
}

/**
 * Split text into alternating Hanifi / non-Hanifi runs. Concatenating the
 * `text` of every segment always reproduces the input exactly.
 */
export function segmentHanifi(text: string): Segment[] {
  const segments: Segment[] = [];
  let current = '';
  let currentIsHanifi = false;
  for (const ch of text) {
    const isHanifi = isHanifiCodePoint(ch.codePointAt(0));
    if (current && isHanifi !== currentIsHanifi) {
      segments.push({ text: current, hanifi: currentIsHanifi });
      current = '';
    }
    current += ch;
    currentIsHanifi = isHanifi;
  }
  if (current) segments.push({ text: current, hanifi: currentIsHanifi });
  return segments;
}
