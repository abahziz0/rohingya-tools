/**
 * What "this website" means: the exact hostname of the page, on http or
 * https, any port. `example.com` does not include `www.example.com` or
 * `news.example.com`; each hostname is a separate choice.
 */

export const STORAGE_SITES_KEY = 'sites';
export const STORAGE_PENDING_KEY = 'pendingEnable';
export const SCRIPT_ID_PREFIX = 'rr-site:';
export const CONTENT_SCRIPT_FILE = 'content.js';
export const ONLINE_CONVERTER_URL = 'https://rohingyalanguage.org/tools/script-converter/';

export interface SitePref {
  enabledAt: number;
}
export type SitePrefs = Record<string, SitePref>;

export type PageKind =
  /** `alwaysSupported` is false for hosts that cannot be saved (e.g. IPv6 literals). */
  | { kind: 'web'; host: string; alwaysSupported: boolean }
  | { kind: 'file' }
  | { kind: 'restricted' };

/** Extension stores: browsers do not allow extensions to script these pages. */
function isStorePage(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (host === 'chromewebstore.google.com' || host === 'microsoftedge.microsoft.com') return true;
  return host === 'chrome.google.com' && url.pathname.startsWith('/webstore');
}

export function classifyUrl(url: string | undefined): PageKind {
  if (!url) return { kind: 'restricted' };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: 'restricted' };
  }
  if (parsed.protocol === 'file:') return { kind: 'file' };
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { kind: 'restricted' };
  if (isStorePage(parsed)) return { kind: 'restricted' };
  const host = parsed.hostname.toLowerCase();
  return { kind: 'web', host, alwaysSupported: isValidHost(host) };
}

/** Hostnames (incl. IPv4 and localhost) we can express as a match pattern. */
export function isValidHost(host: string): boolean {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(host) && host.length <= 253;
}

/** Match patterns covering exactly one hostname (http and https, all ports and paths). */
export const sitePatterns = (host: string): string[] => [`*://${host}/*`];

export const scriptIdForHost = (host: string) => `${SCRIPT_ID_PREFIX}${host}`;

/** Hostname from a match pattern produced by `sitePatterns`, else null. */
export function hostFromPattern(pattern: string): string | null {
  const m = /^(?:\*|https?):\/\/([^/*]+)\/\*?$/.exec(pattern);
  return m && isValidHost(m[1]) ? m[1] : null;
}
