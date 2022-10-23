import { ListenerCollection } from '../shared/listener-collection';

function snapSelectionToWord() {
  // Adapted from https://stackoverflow.com/questions/10964016/how-do-i-extend-selection-to-word-boundary-using-javascript-once-only#comment14316703_10964743
  let sel = window.getSelection();
  if (sel && !sel.isCollapsed && sel.anchorNode && sel.focusNode) {
    // Detect if selection is backwards
    let range = document.createRange();
    range.setStart(sel.anchorNode, sel.anchorOffset);
    range.setEnd(sel.focusNode, sel.focusOffset);
    let backwards = range.collapsed;
    range.detach();

    // modify() works on the focus of the selection
    let endNode = sel.focusNode,
      endOffset = sel.focusOffset;
    sel.collapse(sel.anchorNode, sel.anchorOffset);

    let direction = [];
    if (backwards) {
      direction = ['backward', 'forward'];
    } else {
      direction = ['forward', 'backward'];
    }

    // @ts-ignore
    sel.modify('move', direction[0], 'character');
    // @ts-ignore
    sel.modify('move', direction[1], 'word');
    sel.extend(endNode, endOffset);
    // @ts-ignore
    sel.modify('extend', direction[1], 'character');
    // @ts-ignore
    sel.modify('extend', direction[0], 'word');
  }
}

/**
 * Return the current selection or `null` if there is no selection or it is empty.
 *
 * @param {Document} document
 * @return {Range|null}
 */
export function selectedRange(document) {
  snapSelectionToWord();
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (range.collapsed) {
    return null;
  }
  return range;
}

/**
 * An observer that watches for and buffers changes to the document's current selection.
 */
export class SelectionObserver {
  /**
   * Start observing changes to the current selection in the document.
   *
   * @param {(range: Range|null) => void} callback -
   *   Callback invoked with the selected region of the document when it has
   *   changed.
   * @param {Document} document_ - Test seam
   */
  constructor(callback, document_ = document) {
    let isMouseDown = false;

    this._pendingCallback = null;

    const scheduleCallback = (delay = 10) => {
      this._pendingCallback = setTimeout(() => {
        callback(selectedRange(document_));
      }, delay);
    };

    /** @param {Event} event */
    const eventHandler = event => {
      if (event.type === 'mousedown') {
        isMouseDown = true;
      }
      if (event.type === 'mouseup') {
        isMouseDown = false;
      }

      // If the user makes a selection with the mouse, wait until they release
      // it before reporting a selection change.
      if (isMouseDown) {
        return;
      }

      this._cancelPendingCallback();

      // Schedule a notification after a short delay. The delay serves two
      // purposes:
      //
      // - If this handler was called as a result of a 'mouseup' event then the
      //   selection will not be updated until the next tick of the event loop.
      //   In this case we only need a short delay.
      //
      // - If the user is changing the selection with a non-mouse input (eg.
      //   keyboard or selection handles on mobile) this buffers updates and
      //   makes sure that we only report one when the update has stopped
      //   changing. In this case we want a longer delay.

      const delay = event.type === 'mouseup' ? 10 : 100;
      scheduleCallback(delay);
    };

    this._document = document_;
    this._listeners = new ListenerCollection();

    this._listeners.add(document_, 'selectionchange', eventHandler);

    // Mouse events are handled on the body because propagation may be stopped
    // before they reach the document in some environments (eg. VitalSource).
    this._listeners.add(document_.body, 'mousedown', eventHandler);
    this._listeners.add(document_.body, 'mouseup', eventHandler);

    // Report the initial selection.
    scheduleCallback(1);
  }

  disconnect() {
    this._listeners.removeAll();
    this._cancelPendingCallback();
  }

  _cancelPendingCallback() {
    if (this._pendingCallback) {
      clearTimeout(this._pendingCallback);
      this._pendingCallback = null;
    }
  }
}
