import { TinyEmitter } from 'tiny-emitter';

import { ListenerCollection } from '../../shared/listener-collection';
import { FeatureFlags } from '../features';
import { onDocumentReady } from '../frame-observer';
import { HTMLIntegration } from './html';
import { preserveScrollPosition } from './html-side-by-side';
import { ImageTextLayer } from './image-text-layer';
import { injectClient } from '../hypothesis-injector';

import type {
  Anchor,
  AnnotationData,
  FeatureFlags as IFeatureFlags,
  Integration,
  SegmentInfo,
  SidebarLayout,
} from '../../types/annotator';
import type { EPUBContentSelector, Selector } from '../../types/api';
import type { InjectConfig } from '../hypothesis-injector';

// When activating side-by-side mode for VitalSource PDF documents, make sure
// at least this much space (in pixels) is left for the PDF document. Any
// smaller and it feels unreadable or too-zoomed-out
const MIN_CONTENT_WIDTH = 480;

/**
 * Book metadata exposed by the VitalSource viewer.
 */
type BookInfo = {
  /**
   * Indicates the book type. "epub" means the book was created from an EPUB
   * and the content is XHTML. "pbk" means the book was created from a PDF and
   * has a fixed layout.
   */
  format: 'epub' | 'pbk';

  /**
   * VitalSource book ID ("vbid"). This identifier is _usually_ the book's
   * ISBN, hence the field name. However this value is not always a valid ISBN.
   */
  isbn: string;
  title: string;
};

/**
 * Metadata about a segment of a VitalSource book.
 *
 * Some VS APIs refer to a segment as a "page" (see
 * {@link MosaicBookElement.getCurrentPage} but the amount of content in
 * a segment depends on the book type and publisher. In a PDF-based book,
 * each segment corresponds to a single page of a PDF. In an EPUB-based book,
 * a segment is a single "Content Document" within the EPUB. This typically
 * corresponds to one chapter of the book, but it could be more or less
 * granular.
 */
type PageInfo = {
  /**
   * Path of the resource within the book that contains the segment's resources.
   *
   * eg. In an EPUB a content document might have a URL such as
   * "https://jigsaw.vitalsource.com/books/1234/epub/OEBPS/html/chapter06.html". The corresponding
   * `absoluteURL` entry would be "/books/1234/epub/OEBPS/html/chapter06.html".
   */
  absoluteURL: string;

  /**
   * Identifies the entry in the EPUB's table of contents that corresponds to
   * this page/segment.
   *
   * See https://idpf.org/epub/linking/cfi/#sec-path-res.
   *
   * For PDF-based books, VitalSource creates a synthetic CFI which is the page
   * index, eg. "/1" for the second page.
   */
  cfi: string;

  /**
   * The page label for the first page of the segment. This is the page number
   * that is displayed in the VitalSource navigation controls when the
   * chapter is scrolled to the top.
   */
  page: string;

  /**
   * Index of the current segment within the sequence of pages or content
   * documents that make up the book.
   */
  index: number;

  /**
   * Title of the entry in the table of contents that refers to the current
   * segment. For PDF-based books, a chapter will often have multiple pages
   * and all these pages will have the same title. In EPUBs, each content
   * document will typically have a different title.
   */
  chapterTitle: string;
};

/**
 * `<mosaic-book>` custom element in the VitalSource container frame.
 *
 * This element is part of the VitalSource viewer. It contains the book content
 * inside a frame within its Shadow DOM, and also has methods that can be used
 * to fetch book metadata, get the current location and navigate the book.
 */
type MosaicBookElement = HTMLElement & {
  /** Returns metadata about the currently loaded book. */
  getBookInfo(): BookInfo;

  /**
   * Returns metadata about the current page (in a PDF-based book) or
   * chapter/segment (in an EPUB-based book).
   */
  getCurrentPage(): Promise<PageInfo>;

  /**
   * Navigate the book to the page or content document whose CFI matches `cfi`.
   */
  goToCfi(cfi: string): void;

  /**
   * Navigate the book to the page or content document whose URL matches `url`.
   */
  goToURL(url: string): void;
};

/**
 * Return the custom DOM element that contains the book content iframe.
 */
function findBookElement(document_ = document): MosaicBookElement | null {
  return document_.querySelector('mosaic-book') as MosaicBookElement | null;
}

/**
 * Return the role of the current frame in the VitalSource Bookshelf reader or
 * `null` if the frame is not part of Bookshelf.
 *
 * @return `container` if this is the parent of the content frame, `content` if
 *   this is the frame that contains the book content or `null` if the document is
 *   not part of the Bookshelf reader.
 */
export function vitalSourceFrameRole(
  window_ = window
): 'container' | 'content' | null {
  if (findBookElement(window_.document)) {
    return 'container';
  }

  const parentDoc = window_.frameElement?.ownerDocument;
  if (parentDoc && findBookElement(parentDoc)) {
    return 'content';
  }

  return null;
}

/**
 * VitalSourceInjector runs in the book container frame and loads the client into
 * book content frames.
 *
 * The frame structure of the VitalSource book reader looks like this:
 *
 * [VitalSource top frame - bookshelf.vitalsource.com]
 *   |
 *   [Book container frame - jigsaw.vitalsource.com]
 *     |
 *     [Book content frame - jigsaw.vitalsource.com]
 *
 * The Hypothesis client can be initially loaded in the container frame or the
 * content frame. As the user navigates around the book, the container frame
 * remains the same but the content frame is swapped out. When used in the
 * container frame, this class handles initial injection of the client as a
 * guest in the current content frame, and re-injecting the client into new
 * content frames when they are created.
 */
export class VitalSourceInjector {
  private _frameObserver: MutationObserver;

  /**
   * @param config - Configuration for injecting the client into
   *   book content frames
   */
  constructor(config: InjectConfig) {
    const bookElement = findBookElement();
    if (!bookElement) {
      throw new Error('Book container element not found');
    }

    const contentFrames = new WeakSet<HTMLIFrameElement>();

    const shadowRoot = bookElement.shadowRoot!;
    const injectClientIntoContentFrame = () => {
      const frame = shadowRoot.querySelector('iframe');
      if (!frame || contentFrames.has(frame)) {
        // Either there is no content frame or we are already watching it.
        return;
      }
      contentFrames.add(frame);
      onDocumentReady(frame, (err, document_) => {
        if (err) {
          return;
        }

        // If `err` is null, then `document_` will be set.
        const body = document_!.body;

        const isBookContent =
          body &&
          // Check that this is not the temporary page containing encrypted and
          // invisible book content, which is replaced with the real content after
          // a form submission. These pages look something like:
          //
          // ```
          // <html>
          //   <title>content</title>
          //   <body><div id="page-content">{ Base64 encoded data }</div></body>
          // </html>
          // ```
          !body.querySelector('#page-content');

        if (isBookContent) {
          injectClient(frame, config, 'vitalsource-content');
        }
      });
    };

    injectClientIntoContentFrame();

    // Re-inject client into content frame after a chapter navigation.
    this._frameObserver = new MutationObserver(injectClientIntoContentFrame);
    this._frameObserver.observe(shadowRoot, { childList: true, subtree: true });
  }

  destroy() {
    this._frameObserver.disconnect();
  }
}

/**
 * Bounding box of a single character in the page.
 *
 * Coordinates are expressed in percentage distance from the top-left corner
 * of the rendered page.
 */
type GlyphBox = {
  l: number;
  r: number;
  t: number;
  b: number;
};

type PDFGlyphData = {
  glyphs: GlyphBox[];
};

/**
 * Data that the VitalSource book reader renders into the page about the
 * content and location of text in the image.
 */
type PDFTextData = {
  /** Locations of each text character in the page */
  glyphs: PDFGlyphData;
  /** The text in the page */
  words: string;
};

function getPDFPageImage() {
  return document.querySelector('img#pbk-page') as HTMLImageElement | null;
}

/**
 * Fix how a VitalSource book content frame scrolls, so that various related
 * Hypothesis behaviors (the bucket bar, scrolling annotations into view) work
 * as intended.
 *
 * Some VitalSource books (PDFs) make content scrolling work by making the
 * content iframe really tall and having the parent frame scroll. This stops the
 * Hypothesis bucket bar and scrolling annotations into view from working.
 */
function makeContentFrameScrollable(frame: HTMLIFrameElement) {
  if (frame.getAttribute('scrolling') !== 'no') {
    // This is a book (eg. EPUB) where the workaround is not required.
    return;
  }

  // Override inline styles of iframe (hence `!important`). The iframe lives
  // in Shadow DOM, so the element styles won't affect the rest of the app.
  const style = document.createElement('style');
  style.textContent = `iframe { height: 100% !important; }`;
  frame.insertAdjacentElement('beforebegin', style);

  const removeScrollingAttr = () => frame.removeAttribute('scrolling');
  removeScrollingAttr();

  // Sometimes the attribute gets re-added by VS. Remove it if that
  // happens.
  const attrObserver = new MutationObserver(removeScrollingAttr);
  attrObserver.observe(frame, { attributes: true });
}

/**
 * Integration for the content frame in VitalSource's Bookshelf ebook reader.
 *
 * This integration delegates to the standard HTML integration for most
 * functionality, but it adds logic to:
 *
 *  - Customize the document URI and metadata that is associated with annotations
 *  - Prevent VitalSource's built-in selection menu from getting in the way
 *    of the adder.
 *  - Create a hidden text layer in PDF-based books, so the user can select text
 *    in the PDF image. This is similar to what PDF.js does for us in PDFs.
 */
export class VitalSourceContentIntegration
  extends TinyEmitter
  implements Integration
{
  private _bookElement: MosaicBookElement;
  private _features: IFeatureFlags;
  private _htmlIntegration: HTMLIntegration;
  private _listeners: ListenerCollection;
  private _textLayer?: ImageTextLayer;

  constructor(
    /* istanbul ignore next - defaults are overridden in tests */
    container: HTMLElement = document.body,
    options: {
      features: IFeatureFlags;
      // Test seam
      bookElement?: MosaicBookElement;
    }
  ) {
    super();

    this._features = options.features;

    const bookElement =
      options.bookElement ?? findBookElement(window.parent.document);
    if (!bookElement) {
      /* istanbul ignore next */
      throw new Error(
        'Failed to find <mosaic-book> element in container frame'
      );
    }
    this._bookElement = bookElement;

    // If the book_as_single_document flag changed, this will change the
    // document URI returned by this integration.
    this._features.on('flagsChanged', () => {
      this.emit('uriChanged');
    });

    const htmlFeatures = new FeatureFlags();

    // Forcibly enable the side-by-side feature for VS books. This feature is
    // only behind a flag for regular web pages, which are typically more
    // complex and varied than EPUB books.
    htmlFeatures.update({ html_side_by_side: true });

    this._htmlIntegration = new HTMLIntegration({
      container,
      features: htmlFeatures,
    });

    this._listeners = new ListenerCollection();

    // Prevent mouse events from reaching the window. This prevents VitalSource
    // from showing its native selection menu, which obscures the client's
    // annotation toolbar.
    //
    // To avoid interfering with the client's own selection handling, this
    // event blocking must happen at the same level or higher in the DOM tree
    // than where SelectionObserver listens.
    const stopEvents = ['mouseup', 'mousedown', 'mouseout'];
    for (const event of stopEvents) {
      this._listeners.add(document.documentElement, event, e => {
        e.stopPropagation();
      });
    }

    // Install scrolling workaround for PDFs. We do this in the content frame
    // so that it works whether Hypothesis is loaded directly into the content
    // frame or injected by VitalSourceInjector from the parent frame.
    const frame = window.frameElement as HTMLIFrameElement | null;
    if (frame) {
      makeContentFrameScrollable(frame);
    }

    // If this is a PDF, create the hidden text layer above the rendered PDF
    // image.
    const bookImage = getPDFPageImage();

    const pageData = (window as any).innerPageData as PDFTextData | undefined;

    if (bookImage && pageData) {
      const charRects = pageData.glyphs.glyphs.map(glyph => {
        const left = glyph.l / 100;
        const right = glyph.r / 100;
        const top = glyph.t / 100;
        const bottom = glyph.b / 100;
        return new DOMRect(left, top, right - left, bottom - top);
      });

      this._textLayer = new ImageTextLayer(
        bookImage,
        charRects,
        pageData.words
      );

      // VitalSource has several DOM elements in the page which are raised
      // above the image using z-index. One of these is used to handle VS's
      // own text selection functionality.
      //
      // Set a z-index on our text layer to raise it above VS's own one.
      this._textLayer.container.style.zIndex = '100';
    }
  }

  canAnnotate() {
    return true;
  }

  destroy() {
    this._textLayer?.destroy();
    this._listeners.removeAll();
    this._htmlIntegration.destroy();
  }

  anchor(root: HTMLElement, selectors: Selector[]) {
    return this._htmlIntegration.anchor(root, selectors);
  }

  async describe(root: HTMLElement, range: Range) {
    const selectors: Selector[] = this._htmlIntegration.describe(root, range);
    if (!this._bookIsSingleDocument()) {
      return selectors;
    }

    const pageInfo = await this._bookElement.getCurrentPage();

    // We generate an "EPUBContentSelector" with a CFI for all VS books,
    // although for PDF-based books the CFI is a string generated from the
    // page number.
    const extraSelectors: Selector[] = [
      {
        type: 'EPUBContentSelector',
        cfi: pageInfo.cfi,
        url: pageInfo.absoluteURL,
        title: pageInfo.chapterTitle,
      },
    ];

    // If this is a PDF-based book, add a page selector. PDFs always have page
    // numbers available. EPUB-based books _may_ have information about how
    // content maps to page numbers in a printed edition of the book. We
    // currently limit page number selectors to PDFs until more is understood
    // about when EPUB page numbers are reliable/likely to remain stable.
    const bookInfo = this._bookElement.getBookInfo();
    if (bookInfo.format === 'pbk') {
      extraSelectors.push({
        type: 'PageSelector',
        index: pageInfo.index,
        label: pageInfo.page,
      });
    }

    selectors.push(...extraSelectors);

    return selectors;
  }

  /**
   * Return the sentence from which the text is quoted.
   */
  provideContext(root: HTMLElement, range: Range) {
    return this._htmlIntegration.provideContext(root, range);
  }

  contentContainer() {
    return this._htmlIntegration.contentContainer();
  }

  fitSideBySide(layout: SidebarLayout) {
    // For PDF books, handle side-by-side mode in this integration. For EPUBs,
    // delegate to the HTML integration.
    const bookImage = getPDFPageImage();
    if (bookImage && this._textLayer) {
      const bookContainer = bookImage.parentElement as HTMLElement;
      const textLayer = this._textLayer;

      // Update the PDF image size and alignment to fit alongside the sidebar.
      // `ImageTextLayer` will handle adjusting the text layer to match.
      const newWidth = window.innerWidth - layout.width;

      preserveScrollPosition(() => {
        if (layout.expanded && newWidth > MIN_CONTENT_WIDTH) {
          // The VS book viewer sets `text-align: center` on the <body> element
          // by default, which centers the book image in the page. When the sidebar
          // is open we need the image to be left-aligned.
          bookContainer.style.textAlign = 'left';
          bookImage.style.width = `${newWidth}px`;
        } else {
          bookContainer.style.textAlign = '';
          bookImage.style.width = '';
        }

        // Update text layer to match new image dimensions immediately. This
        // is needed so that `preserveScrollPosition` can see how the content
        // has shifted when this callback returns.
        textLayer.updateSync();
      });

      return layout.expanded;
    } else {
      return this._htmlIntegration.fitSideBySide(layout);
    }
  }

  async getMetadata() {
    if (this._bookIsSingleDocument()) {
      const bookInfo = this._bookElement.getBookInfo();
      return {
        title: bookInfo.title,
        link: [],
      };
    }

    // Return minimal metadata which includes only the information we really
    // want to include.
    return {
      title: document.title,
      link: [],
    };
  }

  navigateToSegment(ann: AnnotationData) {
    const selector = ann.target[0].selector?.find(
      s => s.type === 'EPUBContentSelector'
    ) as EPUBContentSelector | undefined;
    if (selector?.cfi) {
      this._bookElement.goToCfi(selector.cfi);
    } else if (selector?.url) {
      this._bookElement.goToURL(selector.url);
    } else {
      throw new Error('No segment information available');
    }
  }

  persistFrame() {
    // Hint to the sidebar that it should not unload annotations when the
    // guest frame using this integration unloads.
    return true;
  }

  async segmentInfo(): Promise<SegmentInfo> {
    const pageInfo = await this._bookElement.getCurrentPage();
    return {
      cfi: pageInfo.cfi,
      url: pageInfo.absoluteURL,
    };
  }

  async uri() {
    if (this._bookIsSingleDocument()) {
      const bookInfo = this._bookElement.getBookInfo();
      const bookId = bookInfo.isbn;
      return `https://bookshelf.vitalsource.com/reader/books/${bookId}`;
    }

    // An example of a typical URL for the chapter content in the Bookshelf reader is:
    //
    // https://jigsaw.vitalsource.com/books/9781848317703/epub/OPS/xhtml/chapter_001.html#cfi=/6/10%5B;vnd.vst.idref=chap001%5D!/4
    //
    // Where "9781848317703" is the VitalSource book ID ("vbid"), "chapter_001.html"
    // is the location of the HTML page for the current chapter within the book
    // and the `#cfi` fragment identifies the scroll location.
    //
    // Note that this URL is typically different than what is displayed in the
    // iframe's `src` attribute.

    // Strip off search parameters and fragments.
    const uri = new URL(document.location.href);
    uri.search = '';
    return uri.toString();
  }

  async scrollToAnchor(anchor: Anchor) {
    return this._htmlIntegration.scrollToAnchor(anchor);
  }

  /**
   * Return true if the feature flag to treat books as one document is enabled,
   * as opposed to treating each chapter/segment/page as a separate document.
   */
  _bookIsSingleDocument(): boolean {
    return this._features.flagEnabled('book_as_single_document');
  }

  waitForFeatureFlags() {
    // The `book_as_single_document` flag changes the URI reported by this
    // integration.
    //
    // Ask the guest to delay reporting document metadata to the sidebar until
    // feature flags have been received. This ensures that the initial document
    // info reported to the sidebar after a chapter navigation is consistent
    // between the previous/new guest frames.
    return true;
  }
}
