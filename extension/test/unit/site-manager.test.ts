import { beforeEach, describe, expect, it } from 'vitest';
import { SiteManager, type ExtensionApis, type RegisteredScript } from '../../src/background/site-manager';
import { classifyUrl, hostFromPattern, sitePatterns } from '../../src/shared/sites';

/** In-memory stand-in for the Chrome APIs the manager uses. */
function fakeChrome() {
  const local = new Map<string, unknown>();
  const session = new Map<string, unknown>();
  const granted = new Set<string>();
  const registered = new Map<string, RegisteredScript>();
  const area = (m: Map<string, unknown>) => ({
    async get(key: string) {
      return m.has(key) ? { [key]: structuredClone(m.get(key)) } : {};
    },
    async set(items: Record<string, unknown>) {
      for (const [k, v] of Object.entries(items)) m.set(k, structuredClone(v));
    },
  });
  const api: ExtensionApis = {
    storage: { local: area(local), session: area(session) },
    permissions: {
      async contains({ origins }) {
        return origins.every(o => granted.has(o));
      },
      async remove({ origins }) {
        origins.forEach(o => granted.delete(o));
        return true;
      },
    },
    scripting: {
      async getRegisteredContentScripts() {
        return [...registered.values()].map(s => structuredClone(s));
      },
      async registerContentScripts(scripts) {
        for (const s of scripts) if (registered.has(s.id)) throw new Error(`Duplicate script ID '${s.id}'`);
        for (const s of scripts) registered.set(s.id, structuredClone(s));
      },
      async updateContentScripts(scripts) {
        for (const s of scripts) {
          if (!registered.has(s.id)) throw new Error(`No script with ID '${s.id}'`);
          registered.set(s.id, { ...registered.get(s.id)!, ...structuredClone(s) });
        }
      },
      async unregisterContentScripts(filter) {
        if (!filter?.ids) registered.clear();
        else filter.ids.forEach(id => registered.delete(id));
      },
    },
  };
  return { api, local, session, granted, registered };
}

const HOST = 'hanifi.example';
const [PATTERN] = sitePatterns(HOST);
const ID = `rr-site:${HOST}`;

describe('what "this website" means', () => {
  it('uses the exact hostname, both schemes, no subdomains', () => {
    expect(sitePatterns('example.com')).toEqual(['*://example.com/*']);
    expect(classifyUrl('https://www.example.com/a?b')).toEqual({ kind: 'web', host: 'www.example.com', alwaysSupported: true });
    expect(classifyUrl('http://127.0.0.1:8080/x')).toEqual({ kind: 'web', host: '127.0.0.1', alwaysSupported: true });
    expect(hostFromPattern('*://example.com/*')).toBe('example.com');
    expect(hostFromPattern('*://*.example.com/*')).toBeNull();
  });

  it('recognises pages extensions cannot change', () => {
    for (const url of ['chrome://settings', 'chrome-extension://abc/popup.html', 'about:blank', 'view-source:https://a.b', 'https://chromewebstore.google.com/detail/x', 'https://chrome.google.com/webstore/detail/x', undefined]) {
      expect(classifyUrl(url).kind).toBe('restricted');
    }
    expect(classifyUrl('https://chrome.google.com/intl/en/chrome/').kind).toBe('web');
    expect(classifyUrl('file:///Users/x/a.html').kind).toBe('file');
    expect(classifyUrl('http://[::1]:3000/')).toMatchObject({ kind: 'web', alwaysSupported: false });
  });
});

describe('SiteManager lifecycle', () => {
  let chrome: ReturnType<typeof fakeChrome>;
  let converted: Array<[number, string]>;
  let manager: SiteManager;
  let now = 1_000_000;

  beforeEach(() => {
    chrome = fakeChrome();
    converted = [];
    now = 1_000_000;
    manager = new SiteManager(chrome.api, async (tabId, host) => void converted.push([tabId, host]), () => now);
  });

  it('refuses to enable without website access', async () => {
    const result = await manager.enable(HOST, 7);
    expect(result).toMatchObject({ ok: false, reason: 'no-access', state: { enabled: false, hasAccess: false } });
    expect(chrome.registered.size).toBe(0);
    expect(converted).toEqual([]);
  });

  it('enables after access is granted: saves preference, registers script, converts the tab', async () => {
    chrome.granted.add(PATTERN);
    const result = await manager.enable(HOST, 7);
    expect(result).toMatchObject({ ok: true, state: { host: HOST, enabled: true, hasAccess: true } });
    expect(chrome.local.get('sites')).toHaveProperty(HOST);
    expect(chrome.registered.get(ID)).toMatchObject({
      matches: [PATTERN], js: ['content.js'], runAt: 'document_idle', allFrames: false, persistAcrossSessions: true,
    });
    expect(converted).toEqual([[7, HOST]]);
    // Enabling twice is harmless.
    await manager.enable(HOST);
    expect(chrome.registered.size).toBe(1);
  });

  it('finishes enabling from the permission event when the popup closed during the prompt', async () => {
    await manager.prepareEnable(HOST, 3);
    chrome.granted.add(PATTERN); // user clicked "Allow" in Chrome's prompt
    await manager.onPermissionsAdded([PATTERN]);
    expect(await manager.state(HOST)).toEqual({ host: HOST, enabled: true, hasAccess: true });
    expect(chrome.registered.has(ID)).toBe(true);
    expect(converted).toEqual([[3, HOST]]);
    expect((chrome.session.get('pendingEnable') as object) ?? {}).not.toHaveProperty(HOST);
  });

  it('ignores stale pending requests and unrelated grants', async () => {
    await manager.prepareEnable(HOST, 3);
    now += 10 * 60 * 1000; // prompt answered much later
    chrome.granted.add(PATTERN);
    await manager.onPermissionsAdded([PATTERN]);
    expect((await manager.state(HOST)).enabled).toBe(false);
    chrome.granted.add('*://other.example/*');
    await manager.onPermissionsAdded(['*://other.example/*']);
    expect((await manager.state('other.example')).enabled).toBe(false);
  });

  it('handles a declined permission request', async () => {
    await manager.prepareEnable(HOST, 3);
    await manager.cancelPending(HOST); // popup reports "not granted"
    expect(await manager.state(HOST)).toEqual({ host: HOST, enabled: false, hasAccess: false });
    expect(chrome.registered.size).toBe(0);
  });

  it('keeps the preference but unregisters when the user revokes access in Chrome', async () => {
    chrome.granted.add(PATTERN);
    await manager.enable(HOST);
    chrome.granted.delete(PATTERN); // revoked from Chrome's site-access menu
    await manager.onPermissionsRemoved();
    expect(chrome.registered.has(ID)).toBe(false);
    expect(await manager.state(HOST)).toEqual({ host: HOST, enabled: true, hasAccess: false });
    // Access granted again (popup "Allow website access") → registered again.
    chrome.granted.add(PATTERN);
    await manager.onPermissionsAdded([PATTERN]);
    expect(chrome.registered.has(ID)).toBe(true);
  });

  it('detects revocation even if no event was delivered (reconcile on popup open)', async () => {
    chrome.granted.add(PATTERN);
    await manager.enable(HOST);
    chrome.granted.delete(PATTERN);
    const state = await manager.state(HOST);
    expect(state).toEqual({ host: HOST, enabled: true, hasAccess: false });
    expect(chrome.registered.has(ID)).toBe(false);
  });

  it('re-registers scripts lost on extension update or restart', async () => {
    chrome.granted.add(PATTERN);
    await manager.enable(HOST);
    chrome.registered.clear(); // registrations lost on update
    const report = await manager.reconcile();
    expect(report.registered).toEqual([ID]);
    expect(chrome.registered.has(ID)).toBe(true);
  });

  it('fixes inconsistent state: stale registrations and outdated script definitions', async () => {
    chrome.granted.add(PATTERN);
    chrome.registered.set('rr-site:gone.example', { id: 'rr-site:gone.example', matches: ['*://gone.example/*'], js: ['content.js'] });
    chrome.registered.set('someone-else', { id: 'someone-else', matches: ['*://x/*'], js: ['x.js'] });
    chrome.local.set('sites', { [HOST]: { enabledAt: 1 } });
    chrome.registered.set(ID, { id: ID, matches: [PATTERN], js: ['old-content.js'], runAt: 'document_idle', persistAcrossSessions: true });
    const report = await manager.reconcile();
    expect(report.unregistered).toEqual(['rr-site:gone.example']);
    expect(report.updated).toEqual([ID]);
    expect(chrome.registered.get(ID)!.js).toEqual(['content.js']);
    expect(chrome.registered.has('someone-else')).toBe(true); // not ours: untouched
  });

  it('disabling removes the preference, the script and the website access', async () => {
    chrome.granted.add(PATTERN);
    await manager.enable(HOST);
    const state = await manager.disable(HOST);
    expect(state).toEqual({ host: HOST, enabled: false, hasAccess: false });
    expect(chrome.registered.size).toBe(0);
    expect(chrome.granted.has(PATTERN)).toBe(false);
    expect(chrome.local.get('sites')).toEqual({});
  });

  it('serialises concurrent popup and permission-event enables', async () => {
    chrome.granted.add(PATTERN);
    await manager.prepareEnable(HOST, 3);
    const [a] = await Promise.all([manager.enable(HOST, 3), manager.onPermissionsAdded([PATTERN])]);
    expect(a.ok).toBe(true);
    expect(chrome.registered.size).toBe(1);
  });

  it('rejects hosts that are not plain hostnames', async () => {
    const r = await manager.enable('*.example.com');
    expect(r).toMatchObject({ ok: false, reason: 'invalid-host' });
  });
});
