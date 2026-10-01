/**
 * DOM helpers for the page reader: which text may be touched, which text
 * nodes flow together inline, and which element decides text direction.
 */

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
const COMMENT_NODE = 8;

/** Elements whose text is never converted (execution, editing, code, media). */
const SKIP_ELEMENTS = new Set([
  'script', 'style', 'noscript', 'template', 'head', 'title',
  'textarea', 'input', 'select', 'option', 'optgroup', 'datalist',
  'code', 'pre', 'kbd', 'samp', 'var', 'xmp', 'listing', 'plaintext',
  'svg', 'math', 'iframe', 'frame', 'object', 'embed', 'canvas', 'video', 'audio',
]);

/** ARIA roles used by custom editable widgets. */
const EDITABLE_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']);

/** Code / rich-text editors that render their text in ordinary elements. */
const EDITOR_CLASSES = ['CodeMirror', 'cm-editor', 'monaco-editor', 'ace_editor', 'ql-editor', 'ProseMirror'];

/**
 * Inline phrasing elements that do not interrupt a line of text. Text nodes
 * separated only by these elements belong to the same run of text.
 */
const INLINE_ELEMENTS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'big', 'cite', 'data', 'del', 'dfn', 'em', 'font', 'i',
  'ins', 'label', 'mark', 'nobr', 'q', 's', 'small', 'span', 'strike', 'strong', 'sub',
  'sup', 'time', 'tt', 'u',
]);

export function isSkippedElement(el: Element): boolean {
  if (SKIP_ELEMENTS.has(el.localName)) return true;
  const editable = el.getAttribute('contenteditable');
  if (editable !== null && editable.toLowerCase() !== 'false') return true;
  const role = el.getAttribute('role');
  if (role && EDITABLE_ROLES.has(role)) return true;
  const classes = el.classList;
  if (classes && classes.length) {
    for (const cls of EDITOR_CLASSES) if (classes.contains(cls)) return true;
  }
  return false;
}

/**
 * True if the node sits somewhere its text must not be changed: outside
 * <body>, in a skipped element, in an editable region, or in a designMode
 * document. `cache` memoises ancestor answers for one batch of work.
 */
export function isInSkippedContext(node: Node, cache: Map<Element, boolean>): boolean {
  const doc = node.ownerDocument;
  if (!doc || doc.designMode === 'on') return true;
  const chain: Element[] = [];
  let el: Element | null = node.nodeType === ELEMENT_NODE ? (node as Element) : node.parentElement;
  let result: boolean | undefined;
  let reachedBody = false;
  while (el) {
    const known = cache.get(el);
    if (known !== undefined) {
      result = known;
      break;
    }
    chain.push(el);
    if (isSkippedElement(el)) {
      result = true;
      break;
    }
    if (el === doc.body) {
      reachedBody = true;
      result = false;
      break;
    }
    el = el.parentElement;
  }
  // Ran off the top without meeting <body>: detached or in <head>.
  if (result === undefined) result = !reachedBody;
  for (const e of chain) cache.set(e, result);
  if (!result && node.nodeType !== ELEMENT_NODE) {
    // Catch editability that is inherited in ways attributes do not show.
    const parent = node.parentElement as HTMLElement | null;
    if (parent && parent.isContentEditable) return true;
  }
  return result;
}

const isInline = (node: Node): boolean =>
  node.nodeType === ELEMENT_NODE && INLINE_ELEMENTS.has((node as Element).localName) && !isSkippedElement(node as Element);

/**
 * The nearest non-empty text node before/after `node` in the same line of
 * text, crossing only inline elements. Returns null at any block boundary,
 * line break, image, form control, or skipped element.
 */
export function adjacentText(node: Text, forward: boolean): Text | null {
  let cur: Node = node;
  for (let steps = 0; steps < 64; steps++) {
    let next: Node | null = forward ? cur.nextSibling : cur.previousSibling;
    while (!next) {
      const parent: Node | null = cur.parentNode;
      if (!parent || !isInline(parent)) return null;
      cur = parent;
      next = forward ? cur.nextSibling : cur.previousSibling;
    }
    let n: Node = next;
    for (;;) {
      if (n.nodeType === TEXT_NODE) {
        if ((n as Text).data.length) return n as Text;
        cur = n;
        break;
      }
      if (n.nodeType === COMMENT_NODE) {
        cur = n;
        break;
      }
      if (!isInline(n)) return null;
      const child: Node | null = forward ? n.firstChild : n.lastChild;
      if (!child) {
        cur = n;
        break;
      }
      n = child;
    }
  }
  return null;
}

const isDirectionRoot = (el: Element): boolean =>
  !INLINE_ELEMENTS.has(el.localName) || el.hasAttribute('dir') || el.localName === 'bdi' || el.localName === 'bdo';

/**
 * The element that establishes the bidi paragraph (or isolate) this text
 * belongs to: the nearest block, or an inline element with its own `dir`.
 */
export function directionRoot(node: Node): Element | null {
  let el = node.parentElement;
  while (el) {
    if (isDirectionRoot(el)) return el;
    el = el.parentElement;
  }
  return null;
}

/**
 * Text nodes that flow directly inside `root` (not inside nested blocks,
 * nested direction roots, or skipped elements), in document order.
 * Returns null if there are more than `limit` of them.
 */
export function directTextNodes(root: Element, limit: number): Text[] | null {
  const doc = root.ownerDocument;
  const out: Text[] = [];
  const walker = doc.createTreeWalker(root, 0x1 | 0x4 /* SHOW_ELEMENT | SHOW_TEXT */, {
    acceptNode(n) {
      if (n.nodeType === TEXT_NODE) return 1; // FILTER_ACCEPT
      const el = n as Element;
      if (isSkippedElement(el) || isDirectionRoot(el)) return 2; // FILTER_REJECT
      return 3; // FILTER_SKIP
    },
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    out.push(n as Text);
    if (out.length > limit) return null;
  }
  return out;
}

/** Resolved text direction of an element, as the browser renders it. */
export function isRightToLeft(el: Element): boolean {
  return el.ownerDocument.defaultView?.getComputedStyle(el).direction === 'rtl';
}

/** Direction from `dir` attributes only — for environments without CSS (unit tests). */
export function isRightToLeftByAttribute(el: Element): boolean {
  return el.closest('[dir]')?.getAttribute('dir')?.toLowerCase() === 'rtl';
}
