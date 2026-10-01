/**
 * Background service worker: keeps "always convert this website"
 * preferences, host permissions and registered content scripts consistent.
 * It holds no page text.
 */
import type { BackgroundMessage } from '../shared/messages';
import { classifyUrl } from '../shared/sites';
import { readerCommand } from '../shared/tabs';
import { SiteManager } from './site-manager';

async function convertTab(tabId: number, host: string): Promise<void> {
  // Only convert if the tab is still on the website that was enabled.
  const tab = await chrome.tabs.get(tabId);
  const page = classifyUrl(tab.url);
  if (page.kind !== 'web' || page.host !== host) return;
  await readerCommand(tabId, { type: 'rr:start' });
}

const manager = new SiteManager(chrome as unknown as ConstructorParameters<typeof SiteManager>[0], convertTab);

chrome.runtime.onInstalled.addListener(() => void manager.reconcile());
chrome.runtime.onStartup.addListener(() => void manager.reconcile());
chrome.permissions.onAdded.addListener(p => void manager.onPermissionsAdded(p.origins));
chrome.permissions.onRemoved.addListener(() => void manager.onPermissionsRemoved());

const extensionOrigin = chrome.runtime.getURL('');

chrome.runtime.onMessage.addListener((message: BackgroundMessage, sender, sendResponse) => {
  // Only the extension's own pages (the popup) may change site settings.
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(extensionOrigin)) return;
  let work: Promise<unknown>;
  switch (message?.type) {
    case 'rr:site-state':
      work = manager.state(message.host);
      break;
    case 'rr:prepare-enable':
      work = manager.prepareEnable(message.host, message.tabId);
      break;
    case 'rr:cancel-enable':
      work = manager.cancelPending(message.host);
      break;
    case 'rr:enable-site':
      work = manager.enable(message.host, message.tabId);
      break;
    case 'rr:disable-site':
      work = manager.disable(message.host);
      break;
    default:
      return;
  }
  work.then(sendResponse, error => sendResponse({ error: String(error) }));
  return true; // respond asynchronously
});
