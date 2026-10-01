/** Toolbar popup: status, convert / show original, and "always convert this website". */
import type { BackgroundMessage, EnableResult, ReaderStatus, SiteState } from '../shared/messages';
import { classifyUrl, sitePatterns, type PageKind } from '../shared/sites';
import { readerCommand } from '../shared/tabs';
import { buildView, noteHeading, type PopupInput } from './view';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const els = {
  status: $('status'),
  title: $('status-title'),
  detail: $('status-detail'),
  convert: $<HTMLButtonElement>('convert'),
  original: $<HTMLButtonElement>('original'),
  site: $('site'),
  host: $('site-host'),
  always: $<HTMLInputElement>('always'),
  siteDetail: $('site-detail'),
  grant: $<HTMLButtonElement>('grant'),
  notes: $<HTMLDetailsElement>('notes'),
  notesSummary: $('notes-summary'),
  notesList: $('notes-list'),
};

let tabId: number | undefined;
const state: PopupInput = { page: { kind: 'restricted' }, reader: null, site: null };

const background = <T>(message: BackgroundMessage): Promise<T> => chrome.runtime.sendMessage(message) as Promise<T>;

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  // `?tabId=` lets automated tests open this page in a tab and target another tab.
  const override = new URLSearchParams(location.search).get('tabId');
  if (override) return chrome.tabs.get(Number(override));
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** Set text only when it changes, so live regions are not re-announced on every refresh. */
function setText(el: HTMLElement, text: string) {
  if (el.textContent !== text) el.textContent = text;
}

let renderedNotes = '';

function render() {
  const view = buildView(state);
  els.status.dataset.tone = view.tone;
  setText(els.title, view.title);
  setText(els.detail, view.detail);
  els.convert.disabled = !view.canConvert;
  els.original.disabled = !view.canShowOriginal;

  els.site.hidden = !view.site;
  if (view.site) {
    setText(els.host, view.site.host);
    els.always.checked = view.site.checked;
    els.always.disabled = Boolean(state.busy);
    setText(els.siteDetail, view.site.detail);
    els.grant.hidden = !view.site.showGrant;
  }

  const total = view.notes.reduce((n, note) => n + note.count, 0);
  els.notes.hidden = view.notes.length === 0;
  const notesKey = JSON.stringify(view.notes);
  if (view.notes.length && notesKey !== renderedNotes) {
    renderedNotes = notesKey;
    setText(els.notesSummary, `About this conversion (${total} ${total === 1 ? 'note' : 'notes'})`);
    const items = view.notes.map(note => {
      const li = document.createElement('li');
      const heading = document.createElement('p');
      heading.className = 'note-heading';
      heading.textContent = noteHeading(note);
      li.append(heading);
      for (const ex of note.examples) {
        const row = document.createElement('p');
        row.className = 'note-example';
        const orig = document.createElement('span');
        orig.className = 'hanifi';
        orig.lang = 'rhg-Rohg';
        orig.dir = 'rtl';
        orig.textContent = ex.original;
        const arrow = document.createElement('span');
        arrow.className = 'note-arrow';
        arrow.textContent = '→';
        arrow.setAttribute('aria-label', 'shown as');
        const conv = document.createElement('span');
        conv.lang = 'rhg-Latn';
        conv.textContent = ex.converted || '(nothing)';
        row.append(orig, arrow, conv);
        li.append(row);
      }
      const tech = document.createElement('p');
      tech.className = 'note-tech';
      tech.textContent =
        note.kind === 'engine'
          ? `Converter note: ${note.detail}${note.count > 1 ? ` (${note.count} times)` : ''}`
          : `${note.count} ${note.count === 1 ? 'place' : 'places'} on this page`;
      li.append(tech);
      return li;
    });
    els.notesList.replaceChildren(...items);
  }
}

async function refreshReader(inject: boolean) {
  if (tabId === undefined) return;
  try {
    state.reader = inject
      ? await readerCommand(tabId, { type: 'rr:status' })
      : ((await chrome.tabs.sendMessage(tabId, { type: 'rr:status' }, { frameId: 0 })) as ReaderStatus);
    state.unreachable = false;
  } catch {
    if (inject) state.unreachable = true;
  }
}

async function refreshSite() {
  if (state.page.kind !== 'web' || !state.page.alwaysSupported) return;
  try {
    state.site = await background<SiteState>({ type: 'rr:site-state', host: state.page.host });
  } catch {
    state.site = null;
  }
}

async function runCommand(type: 'rr:start' | 'rr:stop') {
  if (tabId === undefined) return;
  state.busy = true;
  state.failed = false;
  render();
  try {
    state.reader = await readerCommand(tabId, { type });
  } catch {
    state.failed = true;
  } finally {
    state.busy = false;
    render();
  }
}

async function finishEnable(host: string) {
  const result = await background<EnableResult>({ type: 'rr:enable-site', host, tabId });
  state.site = result.state;
  state.declined = !result.ok;
  if (result.ok) await runCommand('rr:start');
  else render();
}

/** Ask Chrome for access to this website. Must run synchronously inside a click handler. */
function requestAccessThenEnable(host: string) {
  // Tell the background first: the permission prompt can close this popup,
  // in which case the background finishes enabling when access is granted.
  background({ type: 'rr:prepare-enable', host, tabId }).catch(() => undefined);
  chrome.permissions.request({ origins: sitePatterns(host) }).then(
    granted => {
      if (granted) return finishEnable(host);
      void background({ type: 'rr:cancel-enable', host }).catch(() => undefined);
      state.declined = true;
      render();
    },
    () => {
      state.declined = true;
      render();
    },
  );
}

els.convert.addEventListener('click', () => void runCommand('rr:start'));
els.original.addEventListener('click', () => void runCommand('rr:stop'));

els.always.addEventListener('change', () => {
  const page = state.page;
  if (page.kind !== 'web' || !state.site) return;
  state.declined = false;
  if (els.always.checked) {
    if (state.site.hasAccess) void finishEnable(page.host);
    else requestAccessThenEnable(page.host);
  } else {
    void background<SiteState>({ type: 'rr:disable-site', host: page.host }).then(site => {
      state.site = site;
      render();
    });
  }
});

els.grant.addEventListener('click', () => {
  if (state.page.kind === 'web') requestAccessThenEnable(state.page.host);
});

async function init() {
  const tab = await activeTab().catch(() => undefined);
  tabId = tab?.id;
  const page: PageKind = classifyUrl(tab?.url);
  state.page = page;
  if (page.kind === 'file') state.fileAccess = await chrome.extension.isAllowedFileSchemeAccess();
  if (page.kind === 'web' || (page.kind === 'file' && state.fileAccess)) {
    await Promise.all([refreshReader(true), refreshSite()]);
  }
  render();
  // Keep the status current while the popup is open (e.g. a feed loading more text).
  setInterval(async () => {
    if (state.busy || state.unreachable || !state.reader) return;
    await refreshReader(false);
    render();
  }, 1500);
}

void init();
