/**
 * "Always convert this website": saved preferences, optional host
 * permissions, and dynamically registered content scripts.
 *
 * Three things must agree, and any of them can change underneath us:
 *   1. the saved preference (chrome.storage.local)
 *   2. the host permission (the user can revoke it in Chrome at any time)
 *   3. the registered content script (can be lost on extension update)
 * `reconcile()` derives (3) from (1) and (2), and runs on install/update,
 * browser start-up, permission changes, and whenever the popup asks.
 *
 * The preference is the user's intent and is only removed when the user
 * turns the option off. If access is missing, the preference is kept and
 * the popup explains that website access is required.
 */
import type { EnableResult, SiteState } from '../shared/messages';
import {
  CONTENT_SCRIPT_FILE,
  SCRIPT_ID_PREFIX,
  STORAGE_PENDING_KEY,
  STORAGE_SITES_KEY,
  hostFromPattern,
  isValidHost,
  scriptIdForHost,
  sitePatterns,
  type SitePrefs,
} from '../shared/sites';

/** The subset of the Chrome extension APIs used here (so tests can supply a fake). */
export interface ExtensionApis {
  storage: {
    local: { get(key: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> };
    session: { get(key: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> };
  };
  permissions: {
    contains(p: { origins: string[] }): Promise<boolean>;
    remove(p: { origins: string[] }): Promise<boolean>;
  };
  scripting: {
    getRegisteredContentScripts(filter?: { ids?: string[] }): Promise<RegisteredScript[]>;
    registerContentScripts(scripts: RegisteredScript[]): Promise<void>;
    updateContentScripts(scripts: RegisteredScript[]): Promise<void>;
    unregisterContentScripts(filter?: { ids?: string[] }): Promise<void>;
  };
}

export interface RegisteredScript {
  id: string;
  matches?: string[];
  js?: string[];
  runAt?: 'document_start' | 'document_end' | 'document_idle';
  allFrames?: boolean;
  persistAcrossSessions?: boolean;
}

export interface ReconcileReport {
  registered: string[];
  updated: string[];
  unregistered: string[];
  missingAccess: string[];
  errors: string[];
}

type Pending = Record<string, { tabId?: number; at: number }>;

/** How long a pending "always convert" request waits for Chrome's permission prompt. */
const PENDING_TTL_MS = 5 * 60 * 1000;

export class SiteManager {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly api: ExtensionApis,
    /** Converts the page in a tab after the user enables a site (injected for testability). */
    private readonly convertTab: (tabId: number, host: string) => Promise<void> = async () => {},
    private readonly clock: () => number = Date.now,
  ) {}

  /** Serialise operations so popup actions and permission events cannot interleave. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async prefs(): Promise<SitePrefs> {
    const items = await this.api.storage.local.get(STORAGE_SITES_KEY);
    const value = items[STORAGE_SITES_KEY];
    return value && typeof value === 'object' ? { ...(value as SitePrefs) } : {};
  }

  private async pending(): Promise<Pending> {
    const items = await this.api.storage.session.get(STORAGE_PENDING_KEY);
    const value = items[STORAGE_PENDING_KEY];
    return value && typeof value === 'object' ? { ...(value as Pending) } : {};
  }

  private hasAccess(host: string): Promise<boolean> {
    return this.api.permissions.contains({ origins: sitePatterns(host) }).catch(() => false);
  }

  private desiredScript(host: string): RegisteredScript {
    return {
      id: scriptIdForHost(host),
      matches: sitePatterns(host),
      js: [CONTENT_SCRIPT_FILE],
      runAt: 'document_idle',
      allFrames: false,
      persistAcrossSessions: true,
    };
  }

  // ------------------------------------------------------------------ API

  state(host: string): Promise<SiteState> {
    return this.exclusive(async () => {
      await this.reconcileNow();
      return this.stateNow(host);
    });
  }

  private async stateNow(host: string): Promise<SiteState> {
    const prefs = await this.prefs();
    return { host, enabled: Object.prototype.hasOwnProperty.call(prefs, host), hasAccess: await this.hasAccess(host) };
  }

  /** Remember that the popup is about to ask Chrome for access to `host`. */
  prepareEnable(host: string, tabId?: number): Promise<void> {
    return this.exclusive(async () => {
      if (!isValidHost(host)) return;
      const pending = await this.pending();
      pending[host] = { tabId, at: this.clock() };
      await this.api.storage.session.set({ [STORAGE_PENDING_KEY]: pending });
    });
  }

  cancelPending(host: string): Promise<void> {
    return this.exclusive(async () => {
      const pending = await this.pending();
      if (!(host in pending)) return;
      delete pending[host];
      await this.api.storage.session.set({ [STORAGE_PENDING_KEY]: pending });
    });
  }

  /** Save the preference and register the script. Requires access already granted. */
  enable(host: string, tabId?: number): Promise<EnableResult> {
    return this.exclusive(() => this.enableNow(host, tabId));
  }

  private async enableNow(host: string, tabId?: number): Promise<EnableResult> {
    if (!isValidHost(host)) return { ok: false, reason: 'invalid-host', state: { host, enabled: false, hasAccess: false } };
    if (!(await this.hasAccess(host))) return { ok: false, reason: 'no-access', state: await this.stateNow(host) };
    const prefs = await this.prefs();
    const wasEnabled = Object.prototype.hasOwnProperty.call(prefs, host);
    if (!wasEnabled) {
      prefs[host] = { enabledAt: this.clock() };
      await this.api.storage.local.set({ [STORAGE_SITES_KEY]: prefs });
    }
    const pending = await this.pending();
    if (host in pending) {
      delete pending[host];
      await this.api.storage.session.set({ [STORAGE_PENDING_KEY]: pending });
    }
    const report = await this.reconcileNow();
    if (tabId !== undefined) await this.convertTab(tabId, host).catch(() => undefined);
    const ok = !report.errors.some(e => e.startsWith(`${host}:`));
    return ok ? { ok: true, state: await this.stateNow(host) } : { ok: false, reason: 'error', state: await this.stateNow(host) };
  }

  /** Turn off automatic conversion and give the website access back. */
  disable(host: string): Promise<SiteState> {
    return this.exclusive(async () => {
      const prefs = await this.prefs();
      if (Object.prototype.hasOwnProperty.call(prefs, host)) {
        delete prefs[host];
        await this.api.storage.local.set({ [STORAGE_SITES_KEY]: prefs });
      }
      await this.reconcileNow();
      if (isValidHost(host)) await this.api.permissions.remove({ origins: sitePatterns(host) }).catch(() => false);
      return this.stateNow(host);
    });
  }

  /** Chrome granted new access — finish an "always convert" the popup started. */
  onPermissionsAdded(origins: string[] = []): Promise<void> {
    return this.exclusive(async () => {
      const pending = await this.pending();
      const now = this.clock();
      for (const origin of origins) {
        const host = hostFromPattern(origin);
        const entry = host ? pending[host] : undefined;
        if (host && entry && now - entry.at < PENDING_TTL_MS) await this.enableNow(host, entry.tabId);
      }
      await this.reconcileNow();
    });
  }

  /** Access was removed (by the user in Chrome, or by us). */
  onPermissionsRemoved(): Promise<void> {
    return this.exclusive(async () => {
      await this.reconcileNow();
    });
  }

  reconcile(): Promise<ReconcileReport> {
    return this.exclusive(() => this.reconcileNow());
  }

  private async reconcileNow(): Promise<ReconcileReport> {
    const report: ReconcileReport = { registered: [], updated: [], unregistered: [], missingAccess: [], errors: [] };
    const prefs = await this.prefs();

    const desired = new Map<string, RegisteredScript>();
    for (const host of Object.keys(prefs)) {
      if (!isValidHost(host)) continue;
      if (await this.hasAccess(host)) desired.set(scriptIdForHost(host), this.desiredScript(host));
      else report.missingAccess.push(host);
    }

    const existing = (await this.api.scripting.getRegisteredContentScripts()).filter(s => s.id.startsWith(SCRIPT_ID_PREFIX));
    const existingIds = new Set(existing.map(s => s.id));

    const stale = existing.filter(s => !desired.has(s.id)).map(s => s.id);
    if (stale.length) {
      try {
        await this.api.scripting.unregisterContentScripts({ ids: stale });
        report.unregistered.push(...stale);
      } catch (e) {
        report.errors.push(`unregister: ${String(e)}`);
      }
    }

    for (const script of existing) {
      const want = desired.get(script.id);
      if (!want) continue;
      const same =
        JSON.stringify(script.matches ?? []) === JSON.stringify(want.matches) &&
        JSON.stringify(script.js ?? []) === JSON.stringify(want.js) &&
        (script.runAt ?? 'document_idle') === want.runAt &&
        Boolean(script.allFrames) === want.allFrames &&
        (script.persistAcrossSessions ?? true) === want.persistAcrossSessions;
      if (same) continue;
      try {
        await this.api.scripting.updateContentScripts([want]);
        report.updated.push(script.id);
      } catch (e) {
        report.errors.push(`${script.id.slice(SCRIPT_ID_PREFIX.length)}: ${String(e)}`);
      }
    }

    // Register one at a time so one bad entry cannot block the others.
    for (const [id, script] of desired) {
      if (existingIds.has(id)) continue;
      try {
        await this.api.scripting.registerContentScripts([script]);
        report.registered.push(id);
      } catch (e) {
        report.errors.push(`${id.slice(SCRIPT_ID_PREFIX.length)}: ${String(e)}`);
      }
    }
    return report;
  }
}
