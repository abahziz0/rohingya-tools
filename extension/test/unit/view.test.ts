import { describe, expect, it } from 'vitest';
import type { ReaderStatus } from '../../src/shared/messages';
import { buildView } from '../../src/popup/view';

const web = { kind: 'web' as const, host: 'hanifi.example', alwaysSupported: true };
const reader = (over: Partial<ReaderStatus> = {}): ReaderStatus => ({
  state: 'idle', automatic: false, convertedCount: 0, hanifiFound: true, notes: [], ...over,
});
const site = (enabled: boolean, hasAccess: boolean) => ({ host: 'hanifi.example', enabled, hasAccess });

describe('popup status', () => {
  it('browser pages', () => {
    const v = buildView({ page: { kind: 'restricted' }, reader: null, site: null });
    expect(v.title).toBe('This browser page cannot be converted');
    expect(v.canConvert).toBe(false);
    expect(v.site).toBeNull();
  });

  it('file pages without file access', () => {
    const v = buildView({ page: { kind: 'file' }, fileAccess: false, reader: null, site: null });
    expect(v.title).toBe('This browser page cannot be converted');
    expect(v.detail).toContain('Allow access to file URLs');
  });

  it('ready / no Hanifi / enabled / paused', () => {
    expect(buildView({ page: web, reader: reader(), site: site(false, false) }).title).toBe('Ready to convert');
    const none = buildView({ page: web, reader: reader({ hanifiFound: false }), site: site(false, false) });
    expect(none.title).toBe('No Hanifi text found');
    expect(none.canConvert).toBe(true);
    const on = buildView({ page: web, reader: reader({ state: 'active', convertedCount: 3 }), site: site(false, false) });
    expect(on.title).toBe('Rohingyalish is enabled on this page');
    expect(on.detail).toMatch(/^3 passages converted/);
    expect(on.canConvert).toBe(false);
    expect(on.canShowOriginal).toBe(true);
    const paused = buildView({ page: web, reader: reader({ state: 'paused' }), site: site(true, true) });
    expect(paused.title).toBe('Showing the original text');
    expect(paused.detail).toContain('Always convert stays on for future visits');
  });

  it('website access required', () => {
    const v = buildView({ page: web, reader: reader(), site: site(true, false) });
    expect(v.title).toBe('Website access is required');
    expect(v.site).toMatchObject({ checked: true, showGrant: true });
  });

  it('declined permission', () => {
    const v = buildView({ page: web, reader: reader(), site: site(false, false), declined: true });
    expect(v.site!.checked).toBe(false);
    expect(v.site!.detail).toContain('Access was not allowed');
  });

  it('explains the Chrome prompt before it appears', () => {
    const v = buildView({ page: web, reader: reader(), site: site(false, false) });
    expect(v.site!.detail).toContain('Chrome will ask you to allow access to this website only');
  });
});
