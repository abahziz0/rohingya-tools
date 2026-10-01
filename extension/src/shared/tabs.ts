/** Talking to the page reader in a tab, injecting it first if needed. */
import type { ContentMessage, ReaderStatus } from './messages';
import { CONTENT_SCRIPT_FILE } from './sites';

export async function injectReader(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: [CONTENT_SCRIPT_FILE] });
}

async function send(tabId: number, message: ContentMessage): Promise<ReaderStatus> {
  const status = (await chrome.tabs.sendMessage(tabId, message, { frameId: 0 })) as ReaderStatus | undefined;
  if (!status) throw new Error('No response from page');
  return status;
}

/**
 * Send a command to the reader in the tab's top frame. If the reader is not
 * there yet, inject it (requires activeTab or website access) and retry.
 */
export async function readerCommand(tabId: number, message: ContentMessage): Promise<ReaderStatus> {
  try {
    return await send(tabId, message);
  } catch {
    await injectReader(tabId);
    return send(tabId, message);
  }
}
