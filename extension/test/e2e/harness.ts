import { chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const EXTENSION_DIR = path.resolve(here, '../../dist-test');
export const FIXTURES = 'http://127.0.0.1:4173';

export interface Harness {
  context: BrowserContext;
  worker: Worker;
  extensionId: string;
  userDataDir: string;
}

/** Launch Chromium with the unpacked test build loaded. */
export async function launch(userDataDir?: string): Promise<Harness> {
  const dir = userDataDir ?? (await mkdtemp(path.join(os.tmpdir(), 'rr-e2e-')));
  const context = await chromium.launchPersistentContext(dir, {
    channel: 'chromium', // new headless mode, which supports extensions
    headless: process.env.HEADED ? false : true,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  return { context, worker, extensionId, userDataDir: dir };
}

/** Chrome tab id of a page, looked up by the extension's service worker. */
export async function tabIdOf(h: Harness, page: Page): Promise<number> {
  const url = page.url();
  const ids = await h.worker.evaluate(async (u: string) => (await chrome.tabs.query({})).filter(t => t.url === u).map(t => t.id), url);
  if (!ids.length || ids[0] === undefined) throw new Error(`No tab for ${url}`);
  return ids[ids.length - 1] as number;
}

/**
 * Open the real popup page in a tab, pointed at `target`. (Automation cannot
 * click the toolbar button; `?tabId=` makes the popup act on another tab.)
 */
export async function openPopup(h: Harness, target: Page): Promise<Page> {
  const tabId = await tabIdOf(h, target);
  const popup = await h.context.newPage();
  await popup.setViewportSize({ width: 360, height: 600 });
  await popup.goto(`chrome-extension://${h.extensionId}/popup/popup.html?tabId=${tabId}`);
  await popup.locator('#status-title').filter({ hasNotText: 'Checking this page…' }).waitFor();
  return popup;
}

export const statusTitle = (popup: Page) => popup.locator('#status-title');

/** Text of the page body with our invisible direction isolates removed. */
export const visibleText = (page: Page, selector = 'body') =>
  page.locator(selector).evaluate(el => (el.textContent ?? '').replace(/[⁦⁩]/g, ''));

export const HANIFI = /[\u{10D00}-\u{10D3F}]/u;
