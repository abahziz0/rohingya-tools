/** Pure mapping from extension state to what the popup shows. */
import type { NoteSummary, ReaderStatus, SiteState } from '../shared/messages';
import type { PageKind } from '../shared/sites';

export type Tone = 'neutral' | 'ready' | 'on' | 'warn';

export interface PopupInput {
  page: PageKind;
  /** For file:// pages: whether the user allowed file access. */
  fileAccess?: boolean;
  reader: ReaderStatus | null;
  /** The reader could not be reached or injected into the page. */
  unreachable?: boolean;
  site: SiteState | null;
  /** The last permission request was declined. */
  declined?: boolean;
  /** A command failed (e.g. the page navigated away). */
  failed?: boolean;
  busy?: boolean;
}

export interface PopupView {
  tone: Tone;
  title: string;
  detail: string;
  canConvert: boolean;
  canShowOriginal: boolean;
  site: null | {
    host: string;
    checked: boolean;
    detail: string;
    showGrant: boolean;
  };
  notes: NoteSummary[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function buildView(input: PopupInput): PopupView {
  const { page, reader, site } = input;
  const cannot = (detail: string): PopupView => ({
    tone: 'neutral',
    title: 'This browser page cannot be converted',
    detail,
    canConvert: false,
    canShowOriginal: false,
    site: null,
    notes: [],
  });

  if (page.kind === 'restricted') {
    return cannot('Browser settings, extension stores and some built-in pages cannot be changed by extensions. Open a regular webpage with Hanifi text.');
  }
  if (page.kind === 'file' && !input.fileAccess) {
    return cannot('To convert files on your computer, turn on “Allow access to file URLs” for Rohingya Reader on the Chrome extensions page.');
  }
  if (input.unreachable || !reader) {
    return cannot('The browser did not allow Rohingya Reader to read this page. Try reloading the page, then open Rohingya Reader again.');
  }

  let tone: Tone;
  let title: string;
  let detail: string;
  const accessMissing = Boolean(site?.enabled && !site.hasAccess);

  if (input.failed) {
    tone = 'warn';
    title = 'Something went wrong';
    detail = 'The page may have changed. Reload the page and try again.';
  } else if (reader.state === 'active') {
    tone = 'on';
    title = 'Rohingyalish is enabled on this page';
    const auto = reader.automatic ? ' (automatic for this website)' : '';
    detail =
      reader.convertedCount > 0
        ? `${plural(reader.convertedCount, 'passage', 'passages')} converted${auto}. New text is converted as it loads.`
        : `No Hanifi text found yet${auto}. New text will be converted as it appears.`;
  } else if (accessMissing) {
    tone = 'warn';
    title = 'Website access is required';
    detail = `Chrome is not currently allowing Rohingya Reader to convert ${site!.host} automatically. Allow access below, or use Convert this page.`;
  } else if (reader.state === 'paused') {
    tone = 'neutral';
    title = 'Showing the original text';
    detail = 'Conversion is paused on this page until you choose Convert this page.';
    if (site?.enabled) detail += ` Always convert stays on for future visits to ${site.host}.`;
    if (reader.keptWebsiteChanges) {
      detail += ` ${plural(reader.keptWebsiteChanges, 'passage was', 'passages were')} updated by the website after conversion and left as the website shows ${reader.keptWebsiteChanges === 1 ? 'it' : 'them'}.`;
    }
  } else if (reader.hanifiFound) {
    tone = 'ready';
    title = 'Ready to convert';
    detail = 'This page contains Hanifi text.';
  } else {
    tone = 'neutral';
    title = 'No Hanifi text found';
    detail = 'If Hanifi text appears later, Convert this page will still work.';
  }

  let siteView: PopupView['site'] = null;
  if (page.kind === 'web' && page.alwaysSupported && site) {
    const host = site.host;
    let siteDetail: string;
    if (input.declined && !site.enabled) {
      siteDetail = `Access was not allowed, so ${host} will not convert automatically. You can still use Convert this page.`;
    } else if (accessMissing) {
      siteDetail = `Your choice is saved, but ${host} needs website access before it can convert automatically.`;
    } else if (site.enabled) {
      siteDetail = `${host} converts automatically when you visit. Other websites are not affected.`;
    } else {
      siteDetail = `Convert ${host} automatically on future visits.${site.hasAccess ? '' : ' Chrome will ask you to allow access to this website only.'}`;
    }
    siteView = { host, checked: site.enabled, detail: siteDetail, showGrant: accessMissing };
  }

  return {
    tone,
    title,
    detail,
    canConvert: !input.busy && reader.state !== 'active',
    canShowOriginal: !input.busy && reader.state === 'active',
    site: siteView,
    notes: reader.state === 'active' ? reader.notes : [],
  };
}

/** Plain-language heading for a conversion note. */
export function noteHeading(note: NoteSummary): string {
  if (note.kind === 'kept') return 'Left in Hanifi: this text is split across page elements in a way that could not be converted safely.';
  return 'Converted approximately: check the original if the exact spelling matters.';
}
