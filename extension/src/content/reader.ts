/**
 * PageReader converts Hanifi text in a document to Rohingyalish and can put
 * the original back.
 *
 * Safety rules:
 *  - Only `Text.data` is changed. No elements are created, removed or moved,
 *    no attributes are touched, and innerHTML is never used, so links, event
 *    handlers and page scripts keep working.
 *  - Every changed node remembers its original text and exactly what the
 *    extension wrote. A node whose current text differs from what we wrote
 *    has been changed by the website; restoration then leaves it alone.
 *  - Work is done in small time slices; mutations are batched.
 */
import { convertPieces, convertText, type ConversionResult, type EngineNote } from '../shared/convert';
import { containsHanifi, firstCodePoint, isHanifiCodePoint, lastCodePoint } from '../shared/hanifi';
import type { NoteSummary, ReaderState, ReaderStatus } from '../shared/messages';
import {
  adjacentText,
  directTextNodes,
  directionRoot,
  isInSkippedContext,
  isRightToLeft,
  isSkippedElement,
} from './dom';

const LRI = '⁦'; // LEFT-TO-RIGHT ISOLATE
const PDI = '⁩'; // POP DIRECTIONAL ISOLATE

/** Characters that may sit at the edge of a Rohingyalish passage and belong to it. */
const EDGE_NEUTRAL = /^[\p{P}\p{S}\p{Z}\p{N}\s]$/u;

const MAX_GROUP = 16;
const MAX_DIRECTION_NODES = 2000;
const MAX_NOTE_KINDS = 30;
const MAX_EXAMPLES = 3;
const MAX_EXAMPLE_LENGTH = 80;

interface NodeRecord {
  /** The page's text before the extension changed this node. */
  original: string;
  /** Converted text without direction marks. */
  base: string;
  /** UTF-16 ranges of `base` produced by the engine. */
  ranges: Array<[number, number]>;
  /** Exactly what the extension last wrote into the node. */
  written: string;
}

export interface ReaderOptions {
  /** Time budget per slice of work, in milliseconds. */
  sliceMs?: number;
  /** Delay before processing a burst of mutations. */
  mutationDelayMs?: number;
  /** Resolves whether an element renders right-to-left. */
  isRtl?: (el: Element) => boolean;
  /** Called when the extension context disappears (e.g. extension updated). */
  isContextValid?: () => boolean;
}

const clip = (s: string) => (s.length > MAX_EXAMPLE_LENGTH ? `${s.slice(0, MAX_EXAMPLE_LENGTH - 1)}…` : s);

class NoteCollector {
  private map = new Map<string, NoteSummary>();

  add(kind: NoteSummary['kind'], detail: string, original: string, converted: string) {
    const key = `${kind}:${detail}`;
    let note = this.map.get(key);
    if (!note) {
      if (this.map.size >= MAX_NOTE_KINDS) return;
      note = { kind, detail, count: 0, examples: [] };
      this.map.set(key, note);
    }
    note.count++;
    if (note.examples.length < MAX_EXAMPLES && !note.examples.some(e => e.original === original)) {
      note.examples.push({ original: clip(original), converted: clip(converted) });
    }
  }

  addEngine(notes: EngineNote[]) {
    for (const n of notes) this.add('engine', n.warning, n.original, n.converted);
  }

  list(): NoteSummary[] {
    return [...this.map.values()].map(n => ({ ...n, examples: n.examples.map(e => ({ ...e })) }));
  }

  clear() {
    this.map.clear();
  }
}

export class PageReader {
  private state: ReaderState = 'idle';
  private automatic = false;
  private records = new WeakMap<Text, NodeRecord>();
  private tracked = new Set<WeakRef<Text>>();
  private trackedAtLastCompact = 0;
  private observer: MutationObserver | null = null;
  private queue: Node[] = [];
  private queueHead = 0;
  private queued = new Set<Node>();
  private walker: TreeWalker | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private notes = new NoteCollector();
  private hanifiSeen = false;
  /** Converted nodes the website has since overwritten with its own text. */
  private websiteEdits = 0;
  private readonly sliceMs: number;
  private readonly mutationDelayMs: number;
  private readonly isRtl: (el: Element) => boolean;
  private readonly isContextValid: () => boolean;

  constructor(private readonly doc: Document, options: ReaderOptions = {}) {
    this.sliceMs = options.sliceMs ?? 12;
    this.mutationDelayMs = options.mutationDelayMs ?? 40;
    this.isRtl = options.isRtl ?? isRightToLeft;
    this.isContextValid = options.isContextValid ?? (() => true);
  }

  // ---------------------------------------------------------------- public

  /** Start converting and keep converting new text. Safe to call repeatedly. */
  start(options: { automatic?: boolean } = {}): void {
    if (this.state === 'active') return;
    this.state = 'active';
    this.automatic = options.automatic ?? false;
    this.hanifiSeen = false;
    this.websiteEdits = 0;
    this.notes.clear();
    const view = this.doc.defaultView;
    const Observer = view?.MutationObserver ?? MutationObserver;
    this.observer = new Observer(records => this.onMutations(records));
    this.observer.observe(this.doc.documentElement, { childList: true, subtree: true, characterData: true });
    if (this.doc.body) this.enqueue(this.doc.body);
    this.runSlice(); // convert the first part of the page right away
  }

  /** Start only if the user has not already started or paused this document. */
  startAutomatically(): void {
    if (this.state === 'idle') this.start({ automatic: true });
  }

  /** Restore original text and stop converting this document. */
  stop(): { restored: number; keptWebsiteChanges: number } {
    this.observer?.takeRecords();
    this.observer?.disconnect();
    this.observer = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.queue = [];
    this.queueHead = 0;
    this.queued.clear();
    this.walker = null;

    let restored = 0;
    let keptWebsiteChanges = this.websiteEdits;
    for (const ref of this.tracked) {
      const node = ref.deref();
      if (!node) continue;
      const rec = this.records.get(node);
      if (!rec) continue;
      if (node.data === rec.written) {
        if (node.data !== rec.original) {
          node.data = rec.original;
          if (rec.ranges.length) restored++;
        }
      } else if (rec.ranges.length) {
        // The website replaced this text after conversion: keep its version.
        keptWebsiteChanges++;
      }
      this.records.delete(node);
    }
    this.tracked.clear();
    this.trackedAtLastCompact = 0;
    this.state = 'paused';
    this.automatic = false;
    return { restored, keptWebsiteChanges };
  }

  status(): ReaderStatus {
    let convertedCount = 0;
    for (const ref of this.tracked) {
      const node = ref.deref();
      const rec = node && this.records.get(node);
      if (node && rec && rec.ranges.length && node.data === rec.written && node.isConnected) convertedCount++;
    }
    return {
      state: this.state,
      automatic: this.automatic,
      convertedCount,
      hanifiFound: convertedCount > 0 || this.hanifiSeen || this.detectHanifi(),
      notes: this.notes.list(),
    };
  }

  /** Whether any convertible Hanifi text is present (bounded, read-only scan). */
  detectHanifi(budgetMs = 50): boolean {
    const body = this.doc.body;
    if (!body) return false;
    const deadline = now() + budgetMs;
    const walker = this.createWalker(body);
    const cache = new Map<Element, boolean>();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!isInSkippedContext(n, cache)) return true;
      if (now() > deadline) break;
    }
    return false;
  }

  // ------------------------------------------------------------ scheduling

  private enqueue(node: Node) {
    if (this.queued.has(node)) return;
    this.queued.add(node);
    this.queue.push(node);
  }

  private schedule(delay: number) {
    if (this.timer !== null || this.state !== 'active') return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.runSlice();
    }, delay);
  }

  private onMutations(mutations: MutationRecord[]) {
    if (this.state !== 'active') return;
    for (const m of mutations) {
      if (m.type === 'characterData') {
        const t = m.target as Text;
        const rec = this.records.get(t);
        if (rec && t.data === rec.written) continue; // our own write
        this.enqueue(t);
      } else {
        for (const n of m.addedNodes) {
          if (n.nodeType === 3) {
            const rec = this.records.get(n as Text);
            if (rec && (n as Text).data === rec.written) continue;
            if (containsHanifi((n as Text).data)) this.enqueue(n);
          } else if (n.nodeType === 1) {
            this.enqueue(n);
          }
        }
      }
    }
    if (this.queueHead < this.queue.length) this.schedule(this.mutationDelayMs);
  }

  private dequeue(): Node | undefined {
    if (this.queueHead >= this.queue.length) return undefined;
    const next = this.queue[this.queueHead++];
    if (this.queueHead > 1024 && this.queueHead * 2 > this.queue.length) {
      this.queue = this.queue.slice(this.queueHead);
      this.queueHead = 0;
    }
    this.queued.delete(next);
    return next;
  }

  private createWalker(root: Node): TreeWalker {
    return this.doc.createTreeWalker(root, 0x1 | 0x4 /* SHOW_ELEMENT | SHOW_TEXT */, {
      acceptNode: n => {
        if (n.nodeType === 1) return isSkippedElement(n as Element) ? 2 /* REJECT */ : 3 /* SKIP */;
        const t = n as Text;
        const rec = this.records.get(t);
        if (rec && t.data === rec.written) return 3;
        return containsHanifi(t.data) ? 1 /* ACCEPT */ : 3;
      },
    });
  }

  /** Process queued work until the time budget runs out. */
  private runSlice() {
    if (this.state !== 'active') return;
    if (!this.isContextValid()) {
      // Extension was updated or removed: stop observing, leave the page as is.
      this.observer?.disconnect();
      this.observer = null;
      this.state = 'idle';
      return;
    }
    const deadline = now() + this.sliceMs;
    const cache = new Map<Element, boolean>();
    const touched = new Set<Element>();

    while (now() < deadline) {
      if (!this.walker) {
        const next = this.dequeue();
        if (!next) break;
        if (!next.isConnected) continue;
        if (next.nodeType === 3) {
          if (!isInSkippedContext(next, cache)) this.processText(next as Text, cache, touched);
          continue;
        }
        if (next.nodeType !== 1 || isInSkippedContext(next, cache)) continue;
        this.walker = this.createWalker(next);
      }
      const n = this.walker.nextNode();
      if (!n) {
        this.walker = null;
        continue;
      }
      if (!(n.parentElement as HTMLElement | null)?.isContentEditable) this.processText(n as Text, cache, touched);
    }

    for (const root of touched) this.updateDirection(root);
    this.compactTracked();
    if (this.queueHead < this.queue.length || this.walker) this.schedule(0);
  }

  // ------------------------------------------------------------ conversion

  /** The page's own text for a node (its original if we converted it). */
  private sourceOf(node: Text): string {
    const rec = this.records.get(node);
    return rec && node.data === rec.written ? rec.original : node.data;
  }

  private processText(node: Text, cache: Map<Element, boolean>, touched: Set<Element>) {
    const rec = this.records.get(node);
    if (rec) {
      if (node.data === rec.written) return; // already ours and current
      this.records.delete(node); // the website changed it: its text is the new source
      if (!containsHanifi(node.data)) this.websiteEdits++;
      const root = directionRoot(node);
      if (root) touched.add(root);
    }
    if (!containsHanifi(node.data)) return;
    this.hanifiSeen = true;

    const group = this.buildGroup(node, cache);
    const sources = group.map(n => this.sourceOf(n));
    const result: ConversionResult | null = group.length === 1 ? convertText(sources[0]) : convertPieces(sources);

    if (!result) {
      // No safe way to split this text across elements: keep it as is.
      const joined = sources.join('');
      this.notes.add('kept', 'split-across-elements', joined, joined);
      group.forEach((n, i) => {
        if (this.records.get(n)?.written === n.data) {
          if (n.data !== sources[i]) n.data = sources[i];
        }
        this.setRecord(n, { original: sources[i], base: sources[i], ranges: [], written: sources[i] });
      });
      return;
    }

    this.notes.addEngine(result.notes);
    group.forEach((n, i) => {
      const piece = result.pieces[i];
      const ranges: Array<[number, number]> = [];
      let pos = 0;
      for (const part of piece.parts) {
        if (part.converted && part.text) ranges.push([pos, pos + part.text.length]);
        pos += part.text.length;
      }
      if (n.data !== piece.output) n.data = piece.output;
      // Mark converted even if the engine produced no text (e.g. a tone sign merged into its neighbour).
      const hadHanifi = containsHanifi(sources[i]);
      this.setRecord(n, {
        original: sources[i],
        base: piece.output,
        ranges: ranges.length || !hadHanifi ? ranges : [[0, 0]],
        written: piece.output,
      });
      const root = directionRoot(n);
      if (root) touched.add(root);
    });
  }

  /** Adjacent inline text nodes that form one Hanifi run across element boundaries. */
  private buildGroup(node: Text, cache: Map<Element, boolean>): Text[] {
    const group = [node];
    let cur = node;
    while (group.length < MAX_GROUP && isHanifiCodePoint(firstCodePoint(this.sourceOf(cur)))) {
      const prev = adjacentText(cur, false);
      if (!prev || isInSkippedContext(prev, cache) || !isHanifiCodePoint(lastCodePoint(this.sourceOf(prev)))) break;
      group.unshift(prev);
      cur = prev;
    }
    cur = node;
    while (group.length < MAX_GROUP && isHanifiCodePoint(lastCodePoint(this.sourceOf(cur)))) {
      const next = adjacentText(cur, true);
      if (!next || isInSkippedContext(next, cache) || !isHanifiCodePoint(firstCodePoint(this.sourceOf(next)))) break;
      group.push(next);
      cur = next;
    }
    return group;
  }

  private setRecord(node: Text, rec: NodeRecord) {
    if (!this.records.has(node)) this.tracked.add(new WeakRef(node));
    this.records.set(node, rec);
  }

  private compactTracked() {
    if (this.tracked.size < 2 * this.trackedAtLastCompact + 500) return;
    for (const ref of this.tracked) {
      const node = ref.deref();
      if (!node || !this.records.has(node)) this.tracked.delete(ref);
    }
    this.trackedAtLastCompact = this.tracked.size;
  }

  // ------------------------------------------------------------- direction

  /**
   * Rohingyalish reads left-to-right. When converted text sits in a
   * right-to-left paragraph, wrap the converted passage in an invisible
   * Unicode left-to-right isolate (LRI … PDI) placed inside the existing
   * text nodes. One isolate spans the whole passage, even across links and
   * other inline elements, so word order stays correct. The paragraph's own
   * direction and alignment are not changed, and no attributes are set.
   */
  private updateDirection(root: Element) {
    if (!root.isConnected) return;
    const nodes = directTextNodes(root, MAX_DIRECTION_NODES);
    if (!nodes) return;

    const bases: string[] = [];
    const starts: number[] = [];
    let total = 0;
    let first = -1;
    let last = -1;
    for (const n of nodes) {
      const rec = this.records.get(n);
      const current = rec && n.data === rec.written;
      const base = current ? rec.base : n.data;
      starts.push(total);
      if (current) {
        for (const [a, b] of rec.ranges) {
          if (first < 0) first = total + a;
          last = total + b;
        }
      }
      bases.push(base);
      total += base.length;
    }

    let lri = -1;
    let pdi = -1;
    let lriNode = -1;
    let pdiNode = -1;
    if (first >= 0 && last > first && this.isRtl(root)) {
      const text = bases.join('');
      lri = first;
      while (lri > 0 && EDGE_NEUTRAL.test(charBefore(text, lri))) lri -= charBefore(text, lri).length;
      pdi = last;
      while (pdi < text.length && EDGE_NEUTRAL.test(charAt(text, pdi))) pdi += charAt(text, pdi).length;
      // Whitespace at the edges stays outside the isolate.
      while (lri < first && /\s/.test(text[lri])) lri++;
      while (pdi > last && /\s/.test(text[pdi - 1])) pdi--;
      // LRI goes in the node holding the passage's first character, PDI in the node holding its last.
      lriNode = nodes.findIndex((_, i) => lri < starts[i] + bases[i].length);
      for (let i = 0; i < nodes.length; i++) if (starts[i] < pdi) pdiNode = i;
      if (lriNode < 0 || pdiNode < lriNode) lriNode = pdiNode = -1;
    }

    nodes.forEach((n, i) => {
      const rec = this.records.get(n);
      if (rec && n.data !== rec.written) return; // website-owned text: leave for re-processing
      const base = bases[i];
      const lriAt = i === lriNode ? lri - starts[i] : -1;
      const pdiAt = i === pdiNode ? pdi - starts[i] : -1;
      let desired = base;
      if (pdiAt >= 0) desired = desired.slice(0, pdiAt) + PDI + desired.slice(pdiAt);
      if (lriAt >= 0) desired = desired.slice(0, lriAt) + LRI + desired.slice(lriAt);

      if (!rec) {
        if (desired === base) return;
        this.setRecord(n, { original: base, base, ranges: [], written: desired });
        n.data = desired;
        return;
      }
      if (rec.written === desired) return;
      rec.written = desired;
      if (n.data !== desired) n.data = desired;
      if (!rec.ranges.length && desired === rec.original) {
        // Direction-only record that is no longer needed.
        this.records.delete(n);
      }
    });
  }
}

const charAt = (s: string, i: number) => String.fromCodePoint(s.codePointAt(i) ?? 0);

function charBefore(s: string, i: number): string {
  const low = s.charCodeAt(i - 1);
  if (low >= 0xdc00 && low <= 0xdfff && i >= 2) return s.slice(i - 2, i);
  return s.slice(i - 1, i);
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
