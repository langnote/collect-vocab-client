import classnames from 'classnames';

import { isInPlaceholder } from './anchoring/placeholder';
import { isNodeInRange } from './range-util';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/**
 * Return the canvas element underneath a highlight element in a PDF page's
 * text layer.
 *
 * Returns `null` if the highlight is not above a PDF canvas.
 *
 * @param {HTMLElement} highlightEl -
 *   A `<hypothesis-highlight>` element in the page's text layer
 * @return {HTMLCanvasElement|null}
 */
function getPDFCanvas(highlightEl) {
  // This code assumes that PDF.js renders pages with a structure like:
  //
  // <div class="page">
  //   <div class="canvasWrapper">
  //     <canvas></canvas> <!-- The rendered PDF page -->
  //   </div>
  //   <div class="textLayer">
  //      <!-- Transparent text layer with text spans used to enable text selection -->
  //   </div>
  // </div>
  //
  // It also assumes that the `highlightEl` element is somewhere under
  // the `.textLayer` div.

  const pageEl = highlightEl.closest('.page');
  if (!pageEl) {
    return null;
  }

  const canvasEl = pageEl.querySelector('.canvasWrapper > canvas');
  if (!canvasEl) {
    return null;
  }

  return /** @type {HTMLCanvasElement} */ (canvasEl);
}

/**
 * Draw highlights in an SVG layer overlaid on top of a PDF.js canvas.
 *
 * The created SVG elements are stored in the `svgHighlight` property of
 * each `HighlightElement`.
 *
 * @param {HighlightElement[]} highlightEls -
 *   An element that wraps the highlighted text in the transparent text layer
 *   above the PDF.
 * @param {string} [cssClass] - CSS class(es) to add to the SVG highlight elements
 */
function drawHighlightsAbovePDFCanvas(highlightEls, cssClass) {
  if (highlightEls.length === 0) {
    return;
  }

  // Get the <canvas> for the PDF page containing the highlight. We assume all
  // the highlights are on the same page.
  const canvasEl = getPDFCanvas(highlightEls[0]);
  if (!canvasEl || !canvasEl.parentElement) {
    return;
  }

  /** @type {SVGElement|null} */
  let svgHighlightLayer = canvasEl.parentElement.querySelector(
    '.hypothesis-highlight-layer'
  );

  if (!svgHighlightLayer) {
    // Create SVG layer. This must be in the same stacking context as
    // the canvas so that CSS `mix-blend-mode` can be used to control how SVG
    // content blends with the canvas below.
    svgHighlightLayer = document.createElementNS(SVG_NAMESPACE, 'svg');
    svgHighlightLayer.setAttribute('class', 'hypothesis-highlight-layer');
    canvasEl.parentElement.appendChild(svgHighlightLayer);

    // Overlay SVG layer above canvas.
    canvasEl.parentElement.style.position = 'relative';

    const svgStyle = svgHighlightLayer.style;
    svgStyle.position = 'absolute';
    svgStyle.left = '0';
    svgStyle.top = '0';
    svgStyle.width = '100%';
    svgStyle.height = '100%';

    // Use multiply blending so that highlights drawn on top of text darken it
    // rather than making it lighter. This improves contrast and thus readability
    // of highlighted text, especially for overlapping highlights.
    //
    // This choice optimizes for the common case of dark text on a light background.
    svgStyle.mixBlendMode = 'multiply';
  }

  const canvasRect = canvasEl.getBoundingClientRect();
  const highlightRects = highlightEls.map(highlightEl => {
    const highlightRect = highlightEl.getBoundingClientRect();

    // Create SVG element for the current highlight element.
    const rect = document.createElementNS(SVG_NAMESPACE, 'rect');
    rect.setAttribute('x', (highlightRect.left - canvasRect.left).toString());
    rect.setAttribute('y', (highlightRect.top - canvasRect.top).toString());
    rect.setAttribute('width', highlightRect.width.toString());
    rect.setAttribute('height', highlightRect.height.toString());
    rect.setAttribute(
      'class',
      classnames('hypothesis-svg-highlight', cssClass)
    );

    // Make the highlight in the text layer transparent.
    highlightEl.classList.add('is-transparent');

    // Associate SVG element with highlight for use by `removeHighlights`.
    highlightEl.svgHighlight = rect;

    return rect;
  });

  svgHighlightLayer.append(...highlightRects);
}

/**
 * Additional properties added to text highlight HTML elements.
 *
 * @typedef HighlightProps
 * @prop {SVGElement} [svgHighlight]
 */

/**
 * @typedef {HTMLElement & HighlightProps} HighlightElement
 */

/**
 * Return text nodes which are entirely inside `range`.
 *
 * If a range starts or ends part-way through a text node, the node is split
 * and the part inside the range is returned.
 *
 * @param {Range} range
 * @return {Text[]}
 */
function wholeTextNodesInRange(range) {
  if (range.collapsed) {
    // Exit early for an empty range to avoid an edge case that breaks the algorithm
    // below. Splitting a text node at the start of an empty range can leave the
    // range ending in the left part rather than the right part.
    return [];
  }

  /** @type {Node|null} */
  let root = range.commonAncestorContainer;
  if (root.nodeType !== Node.ELEMENT_NODE) {
    // If the common ancestor is not an element, set it to the parent element to
    // ensure that the loop below visits any text nodes generated by splitting
    // the common ancestor.
    //
    // Note that `parentElement` may be `null`.
    root = root.parentElement;
  }
  if (!root) {
    // If there is no root element then we won't be able to insert highlights,
    // so exit here.
    return [];
  }

  const textNodes = [];
  const nodeIter = /** @type {Document} */ (
    root.ownerDocument
  ).createNodeIterator(
    root,
    NodeFilter.SHOW_TEXT // Only return `Text` nodes.
  );
  let node;
  while ((node = nodeIter.nextNode())) {
    if (!isNodeInRange(range, node)) {
      continue;
    }
    let text = /** @type {Text} */ (node);

    if (text === range.startContainer && range.startOffset > 0) {
      // Split `text` where the range starts. The split will create a new `Text`
      // node which will be in the range and will be visited in the next loop iteration.
      text.splitText(range.startOffset);
      continue;
    }

    if (text === range.endContainer && range.endOffset < text.data.length) {
      // Split `text` where the range ends, leaving it as the part in the range.
      text.splitText(range.endOffset);
    }

    textNodes.push(text);
  }

  return textNodes;
}

/**
 * Wraps the DOM Nodes within the provided range with a highlight
 * element of the specified class and returns the highlight Elements.
 *
 * @param {Range} range - Range to be highlighted
 * @param {string} [cssClass] - CSS class(es) to add to the highlight elements
 * @return {HighlightElement[]} - Elements wrapping text in `normedRange` to add a highlight effect
 */
export function highlightRange(range, cssClass) {
  const textNodes = wholeTextNodesInRange(range);

  // Check if this range refers to a placeholder for not-yet-rendered content in
  // a PDF. These highlights should be invisible.
  const inPlaceholder = textNodes.length > 0 && isInPlaceholder(textNodes[0]);

  // Group text nodes into spans of adjacent nodes. If a group of text nodes are
  // adjacent, we only need to create one highlight element for the group.
  let textNodeSpans = /** @type {Text[][]} */ ([]);
  let prevNode = /** @type {Node|null} */ (null);
  let currentSpan = null;

  textNodes.forEach(node => {
    if (prevNode && prevNode.nextSibling === node) {
      currentSpan.push(node);
    } else {
      currentSpan = [node];
      textNodeSpans.push(currentSpan);
    }
    prevNode = node;
  });

  // Filter out text node spans that consist only of white space. This avoids
  // inserting highlight elements in places that can only contain a restricted
  // subset of nodes such as table rows and lists.
  const whitespace = /^\s*$/;
  textNodeSpans = textNodeSpans.filter(span =>
    // Check for at least one text node with non-space content.
    span.some(node => !whitespace.test(node.data))
  );

  // Wrap each text node span with a `<hypothesis-highlight>` element.
  const highlights = /** @type {HighlightElement[]} */ ([]);
  textNodeSpans.forEach(nodes => {
    // A custom element name is used here rather than `<span>` to reduce the
    // likelihood of highlights being hidden by page styling.

    /** @type {HighlightElement} */
    const highlightEl = document.createElement('hypothesis-highlight');
    highlightEl.className = classnames('hypothesis-highlight', cssClass);

    const parent = /** @type {Node} */ (nodes[0].parentNode);
    parent.replaceChild(highlightEl, nodes[0]);
    nodes.forEach(node => highlightEl.appendChild(node));

    highlights.push(highlightEl);
  });

  // For PDF highlights, create the highlight effect by using an SVG placed
  // above the page's canvas rather than CSS `background-color` on the highlight
  // element. This enables more control over blending of the highlight with the
  // content below.
  //
  // Drawing these SVG highlights involves measuring the `<hypothesis-highlight>`
  // elements, so we create them only after those elements have all been created
  // to reduce the number of forced reflows. We also skip creating them for
  // unrendered pages for performance reasons.
  if (!inPlaceholder) {
    drawHighlightsAbovePDFCanvas(highlights, cssClass);
  }

  return highlights;
}

/**
 * Replace a child `node` with `replacements`.
 *
 * nb. This is like `ChildNode.replaceWith` but it works in older browsers.
 *
 * @param {ChildNode} node
 * @param {Node[]} replacements
 */
function replaceWith(node, replacements) {
  const parent = /** @type {Node} */ (node.parentNode);
  replacements.forEach(r => parent.insertBefore(r, node));
  node.remove();
}

/**
 * Remove all highlights under a given root element.
 *
 * @param {HTMLElement} root
 */
export function removeAllHighlights(root) {
  const highlights = Array.from(root.querySelectorAll('hypothesis-highlight'));
  removeHighlights(/** @type {HighlightElement[]} */ (highlights));
}

/**
 * Remove highlights from a range previously highlighted with `highlightRange`.
 *
 * @param {HighlightElement[]} highlights - The highlight elements returned by `highlightRange`
 */
export function removeHighlights(highlights) {
  for (let h of highlights) {
    if (h.parentNode) {
      const children = Array.from(h.childNodes);
      replaceWith(h, children);
    }

    if (h.svgHighlight) {
      h.svgHighlight.remove();
    }
  }
}

/**
 * Set whether the given highlight elements should appear "focused".
 *
 * A highlight can be displayed in a different ("focused") style to indicate
 * that it is current in some other context - for example the user has selected
 * the corresponding annotation in the sidebar.
 *
 * @param {HighlightElement[]} highlights
 * @param {boolean} focused
 */
export function setHighlightsFocused(highlights, focused) {
  highlights.forEach(h => {
    // In PDFs the visible highlight is created by an SVG element, so the focused
    // effect is applied to that. In other documents the effect is applied to the
    // `<hypothesis-highlight>` element.
    if (h.svgHighlight) {
      h.svgHighlight.classList.toggle('is-focused', focused);

      // Ensure that focused highlights are drawn above un-focused highlights
      // on the same page.
      //
      // SVG elements are rendered in document order so to achieve this we need
      // to move the element to be the last child of its parent.
      if (focused) {
        const parent = /** @type {SVGElement} */ (h.svgHighlight.parentNode);
        parent.append(h.svgHighlight);
      }
    } else {
      h.classList.toggle('hypothesis-highlight-focused', focused);
    }
  });
}

/**
 * Set whether highlights under the given root element should be visible.
 *
 * @param {HTMLElement} root
 * @param {boolean} visible
 */
export function setHighlightsVisible(root, visible) {
  const showHighlightsClass = 'hypothesis-highlights-always-on';
  root.classList.toggle(showHighlightsClass, visible);
}

/**
 * Get the highlight elements that contain the given node.
 *
 * @param {Node} node
 * @return {HighlightElement[]}
 */
export function getHighlightsContainingNode(node) {
  let el =
    node.nodeType === Node.ELEMENT_NODE
      ? /** @type {Element} */ (node)
      : node.parentElement;

  const highlights = [];

  while (el) {
    if (el.classList.contains('hypothesis-highlight')) {
      highlights.push(/** @type {HighlightElement} */ (el));
    }
    el = el.parentElement;
  }

  return highlights;
}

/**
 * Subset of `DOMRect` interface.
 *
 * @typedef Rect
 * @prop {number} top
 * @prop {number} left
 * @prop {number} bottom
 * @prop {number} right
 */

/**
 * Get the bounding client rectangle of a collection in viewport coordinates.
 * Unfortunately, Chrome has issues ([1]) with Range.getBoundingClient rect or we
 * could just use that.
 *
 * [1] https://bugs.chromium.org/p/chromium/issues/detail?id=324437
 *
 * @param {HTMLElement[]} collection
 * @return {Rect}
 */
export function getBoundingClientRect(collection) {
  // Reduce the client rectangles of the highlights to a bounding box
  const rects = collection.map(
    n => /** @type {Rect} */ (n.getBoundingClientRect())
  );
  return rects.reduce((acc, r) => ({
    top: Math.min(acc.top, r.top),
    left: Math.min(acc.left, r.left),
    bottom: Math.max(acc.bottom, r.bottom),
    right: Math.max(acc.right, r.right),
  }));
}
