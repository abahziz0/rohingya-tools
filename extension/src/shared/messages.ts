/** Messages exchanged between the popup, background worker and content script. */

export type ReaderState = 'idle' | 'active' | 'paused';

export interface NoteExample {
  original: string;
  converted: string;
}

export interface NoteSummary {
  /** 'engine': approximation/warning reported by the shared engine.
   *  'kept': text left unchanged because it could not be converted safely. */
  kind: 'engine' | 'kept';
  /** Engine warning text (technical), or a fixed description for 'kept'. */
  detail: string;
  count: number;
  examples: NoteExample[];
}

export interface ReaderStatus {
  state: ReaderState;
  /** Whether conversion was started by a saved "always convert" preference. */
  automatic: boolean;
  /** Text nodes currently showing converted text. */
  convertedCount: number;
  /** Whether supported Hanifi text is (or was) present in the page. */
  hanifiFound: boolean;
  notes: NoteSummary[];
  /** After "Show original": text the website changed since conversion and that was left as the website set it. */
  keptWebsiteChanges?: number;
}

export type ContentMessage =
  | { type: 'rr:status' }
  | { type: 'rr:start' }
  | { type: 'rr:stop' };

export interface SiteState {
  host: string;
  /** "Always convert this website" is saved. */
  enabled: boolean;
  /** Chrome currently grants this extension access to the website. */
  hasAccess: boolean;
}

export type BackgroundMessage =
  | { type: 'rr:site-state'; host: string }
  | { type: 'rr:prepare-enable'; host: string; tabId?: number }
  | { type: 'rr:cancel-enable'; host: string }
  | { type: 'rr:enable-site'; host: string; tabId?: number }
  | { type: 'rr:disable-site'; host: string };

export type EnableResult = { ok: true; state: SiteState } | { ok: false; reason: 'no-access' | 'invalid-host' | 'error'; state: SiteState };
