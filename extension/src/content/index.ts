/**
 * Content script entry. Injected on demand (activeTab + scripting) or by a
 * dynamically registered script for websites the user chose to always
 * convert. Injection is idempotent: a second injection into the same
 * document reuses the existing reader.
 */
import type { ContentMessage, ReaderStatus } from '../shared/messages';
import { STORAGE_SITES_KEY, type SitePrefs } from '../shared/sites';
import { PageReader } from './reader';

declare global {
  // eslint-disable-next-line no-var
  var __rohingyaReader: PageReader | undefined;
}

const contextValid = () => {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
};

function init(): void {
  const reader = new PageReader(document, { isContextValid: contextValid });
  globalThis.__rohingyaReader = reader;

  chrome.runtime.onMessage.addListener((message: ContentMessage, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return;
    let response: ReaderStatus | undefined;
    switch (message?.type) {
      case 'rr:status':
        response = reader.status();
        break;
      case 'rr:start':
        reader.start();
        response = reader.status();
        break;
      case 'rr:stop': {
        const { keptWebsiteChanges } = reader.stop();
        response = { ...reader.status(), keptWebsiteChanges };
        break;
      }
      default:
        return;
    }
    sendResponse(response);
  });

  // Saved "always convert this website" preference.
  const host = location.hostname;
  if (host && (location.protocol === 'https:' || location.protocol === 'http:')) {
    chrome.storage.local
      .get(STORAGE_SITES_KEY)
      .then(items => {
        const sites = (items[STORAGE_SITES_KEY] ?? {}) as SitePrefs;
        if (Object.prototype.hasOwnProperty.call(sites, host)) reader.startAutomatically();
      })
      .catch(() => {
        /* storage unavailable: stay idle */
      });
  }
}

if (!globalThis.__rohingyaReader) init();
