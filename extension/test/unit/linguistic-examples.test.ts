/**
 * Checks converter/transliteration-examples.json against the shared engine.
 *
 *  - verified:        must match the engine, unless marked `engineKnownDifference`
 *                     (a known engine issue: it must still differ, so the flag is
 *                     removed when the engine is fixed).
 *  - engine-snapshot: must match exactly; a failure means engine behaviour changed.
 *                     Snapshots are NOT evidence of linguistic accuracy.
 *  - needs-review:    format-checked only.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hanifiToLatin } from '../../../converter/transliterate';
import { containsHanifi } from '../../src/shared/hanifi';

interface Example {
  id: string;
  hanifi: string;
  rohingyalish: string;
  status: 'verified' | 'needs-review' | 'engine-snapshot';
  source: string;
  review?: { reviewers: Array<{ name: string; reads: string[] }>; date: string };
  engineKnownDifference?: boolean;
  warnings?: string[];
  notes?: string;
}

const data = JSON.parse(readFileSync(new URL('../../../converter/transliteration-examples.json', import.meta.url), 'utf8')) as {
  format: string;
  version: number;
  examples: Example[];
};

describe('transliteration examples file', () => {
  it('has the expected format', () => {
    expect(data.format).toBe('rohingya-transliteration-examples');
    expect(data.version).toBe(1);
    const ids = new Set<string>();
    for (const e of data.examples) {
      expect(ids.has(e.id), `duplicate id ${e.id}`).toBe(false);
      ids.add(e.id);
      expect(['verified', 'needs-review', 'engine-snapshot']).toContain(e.status);
      expect(containsHanifi(e.hanifi), `${e.id}: hanifi must contain Hanifi`).toBe(true);
      expect(typeof e.rohingyalish).toBe('string');
      expect(e.source, `${e.id}: source is required`).toBeTruthy();
      if (e.status === 'verified') {
        expect(e.review?.reviewers.length ?? 0, `${e.id}: verified needs at least 2 reviewers`).toBeGreaterThanOrEqual(2);
        for (const r of e.review!.reviewers) expect(r.reads.sort()).toEqual(['hanifi', 'rohingyalish']);
        expect(e.review!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it('verified examples agree with the engine (or are tracked as known differences)', () => {
    const verified = data.examples.filter(e => e.status === 'verified');
    const known: string[] = [];
    for (const e of verified) {
      const out = hanifiToLatin(e.hanifi).output;
      if (e.engineKnownDifference) {
        expect(out, `${e.id}: engine now matches — remove engineKnownDifference`).not.toBe(e.rohingyalish);
        known.push(`${e.id}: engine “${out}”, reviewed “${e.rohingyalish}”`);
      } else {
        expect(out, `${e.id}: engine output differs from the reviewed spelling`).toBe(e.rohingyalish);
      }
    }
    if (!verified.length) console.info('No verified examples yet: linguistic accuracy is untested. See transliteration-examples.md.');
    if (known.length) console.info(`Known engine differences:\n  ${known.join('\n  ')}`);
  });

  it('engine snapshots are unchanged', () => {
    for (const e of data.examples.filter(x => x.status === 'engine-snapshot')) {
      const r = hanifiToLatin(e.hanifi);
      expect(r.output, `${e.id}: engine output changed (re-run npm run examples:snapshot if intended)`).toBe(e.rohingyalish);
      expect(r.warnings, `${e.id}: engine warnings changed`).toEqual(e.warnings ?? []);
    }
  });
});
