import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { es } from '../../i18n/es';
import { formatNumber } from '../../i18n/format';
import type {
  PageRenderQueue,
  RenderJobStatus,
} from '../../pdf/page-render-queue';
import { normalizePageRotation } from '../../pdf/page-rotation';

const minimumZoom = 0.25;
const maximumZoom = 3;
const zoomStep = 0.25;
const maxCanvasPixels = 16_777_216;
const maxCanvasDimension = 8192;

export interface PageInfo {
  widthMillimeters: number;
  heightMillimeters: number;
  rotation: number;
}

interface PageViewerProps {
  document: PDFDocumentProxy;
  pageId: string;
  sourcePageNumber: number;
  rotationDeltaDegrees: number;
  pageNumber: number;
  pageCount: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  pageActionsDisabled: boolean;
  onPageChange: (pageNumber: number) => void;
  onMovePage: (direction: 'up' | 'down') => void;
  onDuplicatePage: () => void;
  onRotatePage: () => void;
  onDeletePage: () => void;
  onPageInfo: (pageId: string, info: PageInfo) => void;
  onImport: () => void;
  importDisabled: boolean;
  renderQueue: PageRenderQueue;
}

interface ViewportSize {
  width: number;
  height: number;
}

interface PageDimensions {
  width: number;
  height: number;
}

export function PageViewer({
  document,
  pageId,
  sourcePageNumber,
  rotationDeltaDegrees,
  pageNumber,
  pageCount,
  canMoveUp,
  canMoveDown,
  pageActionsDisabled,
  onPageChange,
  onMovePage,
  onDuplicatePage,
  onRotatePage,
  onDeletePage,
  onPageInfo,
  onImport,
  importDisabled,
  renderQueue,
}: PageViewerProps) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState<ViewportSize>({
    width: 0,
    height: 0,
  });
  const [pageDimensions, setPageDimensions] = useState<PageDimensions | null>(
    null,
  );
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [renderErrorPageId, setRenderErrorPageId] = useState<string | null>(
    null,
  );
  const [renderJobState, setRenderJobState] = useState<{
    pageId: string;
    status: RenderJobStatus;
  }>({ pageId, status: 'queued' });
  const renderError = renderErrorPageId === pageId;
  const renderStatus =
    renderJobState.pageId === pageId
      ? renderJobState.status
      : 'queued';

  useEffect(() => {
    const element = viewerRef.current;
    if (!element) {
      return;
    }

    const updateSize = (): void => {
      setViewportSize({
        width: element.clientWidth,
        height: element.clientHeight,
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fitZoom =
    pageDimensions && viewportSize.width > 0 && viewportSize.height > 0
      ? Math.max(
          0.05,
          Math.min(
            (viewportSize.width - 48) / pageDimensions.width,
            (viewportSize.height - 48) / pageDimensions.height,
            maximumZoom,
          ),
        )
      : 1;
  const effectiveZoom = zoom === 'fit' ? fitZoom : zoom;
  const zoomPercentage = Math.round(effectiveZoom * 100);

  useEffect(() => {
    const canvas = viewerRef.current?.querySelector('canvas');
    if (!canvas || viewportSize.width === 0 || viewportSize.height === 0) {
      return;
    }
    const targetCanvas = canvas;

    let cancelled = false;
    const renderHandle = renderQueue.enqueue({
      priority: 'visible-page',
      onStatus: (status) => {
        if (!cancelled) {
          setRenderJobState({ pageId, status });
          if (status === 'queued') {
            setRenderErrorPageId((currentPageId) =>
              currentPageId === pageId ? null : currentPageId,
            );
          }
        }
      },
      run: async (signal) => {
        if (signal.aborted) {
          return;
        }
        const page = await document.getPage(sourcePageNumber);
        try {
          if (signal.aborted) {
            return;
          }

          const rotation = normalizePageRotation(
            page.rotate + rotationDeltaDegrees,
          );
          const baseViewport = page.getViewport({ scale: 1, rotation });
          if (baseViewport.width <= 0 || baseViewport.height <= 0) {
            throw new Error('The PDF page has invalid dimensions.');
          }
          const pageArea = baseViewport.width * baseViewport.height;
          if (!Number.isFinite(pageArea) || pageArea <= 0) {
            throw new Error('The PDF page area is invalid.');
          }
          setPageDimensions({
            width: baseViewport.width,
            height: baseViewport.height,
          });
          onPageInfo(pageId, {
            widthMillimeters: (baseViewport.width * 25.4) / 72,
            heightMillimeters: (baseViewport.height * 25.4) / 72,
            rotation,
          });

          const deviceScale = Math.min(window.devicePixelRatio || 1, 2);
          const desiredScale = effectiveZoom * deviceScale;
          const areaLimitedScale = Math.sqrt(maxCanvasPixels / pageArea);
          const dimensionLimitedScale =
            maxCanvasDimension /
            Math.max(baseViewport.width, baseViewport.height);
          const renderScale = Math.min(
            desiredScale,
            areaLimitedScale,
            dimensionLimitedScale,
          );
          const viewport = page.getViewport({ scale: renderScale, rotation });
          targetCanvas.width = Math.max(1, Math.ceil(viewport.width));
          targetCanvas.height = Math.max(1, Math.ceil(viewport.height));
          targetCanvas.style.width = `${Math.ceil(baseViewport.width * effectiveZoom)}px`;
          targetCanvas.style.height = `${Math.ceil(baseViewport.height * effectiveZoom)}px`;

          const context = targetCanvas.getContext('2d', { alpha: false });
          if (!context) {
            throw new Error('Canvas 2D context is unavailable.');
          }

          const renderTask = page.render({
            canvas: targetCanvas,
            canvasContext: context,
            viewport,
          });
          const cancelRender = (): void => renderTask.cancel();
          signal.addEventListener('abort', cancelRender, { once: true });
          if (signal.aborted) {
            cancelRender();
          }
          try {
            await renderTask.promise;
          } finally {
            signal.removeEventListener('abort', cancelRender);
          }
        } finally {
          page.cleanup();
        }
      },
    });
    void renderHandle.promise.catch(() => {
      if (!cancelled) {
        setRenderErrorPageId(pageId);
      }
    });

    return () => {
      cancelled = true;
      renderHandle.cancel();
    };
  }, [
    document,
    effectiveZoom,
    onPageInfo,
    pageId,
    renderQueue,
    rotationDeltaDegrees,
    sourcePageNumber,
    viewportSize.height,
    viewportSize.width,
  ]);

  function handleViewerKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.target !== event.currentTarget) {
      return;
    }

    if (event.key === 'ArrowLeft' && pageNumber > 1) {
      event.preventDefault();
      onPageChange(pageNumber - 1);
    } else if (event.key === 'ArrowRight' && pageNumber < pageCount) {
      event.preventDefault();
      onPageChange(pageNumber + 1);
    }
  }

  return (
    <section className="pdf-viewer" aria-label={es.viewer.region}>
      <div className="viewer-toolbar">
        <div className="viewer-page-controls">
          <button
            className="viewer-control"
            type="button"
            aria-label={es.viewer.previousPage}
            disabled={pageNumber <= 1}
            onClick={() => onPageChange(pageNumber - 1)}
          >
            ‹
          </button>
          <PageNumberForm
            key={pageNumber}
            pageNumber={pageNumber}
            pageCount={pageCount}
            onPageChange={onPageChange}
          />
          <button
            className="viewer-control"
            type="button"
            aria-label={es.viewer.nextPage}
            disabled={pageNumber >= pageCount}
            onClick={() => onPageChange(pageNumber + 1)}
          >
            ›
          </button>
        </div>

        <div
          className="viewer-page-actions"
          role="group"
          aria-label={es.pages.actionsHeading}
        >
          <button
            className="viewer-control"
            type="button"
            aria-label={es.pages.moveUp}
            title={es.pages.moveUp}
            disabled={pageActionsDisabled || !canMoveUp}
            onClick={() => onMovePage('up')}
          >
            ↑
          </button>
          <button
            className="viewer-control"
            type="button"
            aria-label={es.pages.moveDown}
            title={es.pages.moveDown}
            disabled={pageActionsDisabled || !canMoveDown}
            onClick={() => onMovePage('down')}
          >
            ↓
          </button>
          <button
            className="viewer-control"
            type="button"
            aria-label={es.pages.duplicate}
            title={es.pages.duplicate}
            disabled={pageActionsDisabled}
            onClick={onDuplicatePage}
          >
            +
          </button>
          <button
            className="viewer-control"
            type="button"
            aria-label={es.pages.rotate}
            title={es.pages.rotate}
            disabled={pageActionsDisabled}
            onClick={onRotatePage}
          >
            ↻
          </button>
          <button
            className="viewer-control"
            type="button"
            aria-label={es.pages.delete}
            title={es.pages.delete}
            disabled={pageActionsDisabled}
            onClick={onDeletePage}
          >
            ×
          </button>
        </div>

        <div className="viewer-zoom-controls">
          <button
            className="viewer-control"
            type="button"
            aria-label={es.viewer.zoomOut}
            disabled={effectiveZoom <= minimumZoom}
            onClick={() =>
              setZoom(
                Math.max(
                  minimumZoom,
                  Math.round((effectiveZoom - zoomStep) * 100) / 100,
                ),
              )
            }
          >
            −
          </button>
          <span className="viewer-zoom-value" aria-live="polite">
            {es.viewer.zoomLevel}: {zoomPercentage}%
          </span>
          <button
            className="viewer-control"
            type="button"
            aria-label={es.viewer.zoomIn}
            disabled={effectiveZoom >= maximumZoom}
            onClick={() =>
              setZoom(
                Math.min(
                  maximumZoom,
                  Math.round((effectiveZoom + zoomStep) * 100) / 100,
                ),
              )
            }
          >
            +
          </button>
          <button
            className="viewer-control viewer-fit-control"
            type="button"
            aria-label={es.viewer.fitPage}
            onClick={() => setZoom('fit')}
          >
            {es.viewer.fit}
          </button>
        </div>

        <button
          className="viewer-control viewer-import-control"
          type="button"
          disabled={importDisabled}
          onClick={onImport}
        >
          {es.documents.importButton}
        </button>
      </div>

      <div
        ref={viewerRef}
        className="viewer-canvas-scroll"
        role="region"
        aria-label={es.viewer.pageCanvas}
        aria-describedby="viewer-keyboard-help"
        aria-busy={
          !renderError &&
          (renderStatus === 'queued' || renderStatus === 'running')
        }
        tabIndex={0}
        onKeyDown={handleViewerKeyDown}
      >
        <span id="viewer-keyboard-help" className="visually-hidden">
          {es.viewer.keyboardHelp}
        </span>
        {(renderStatus === 'queued' || renderStatus === 'running') &&
          !renderError && (
            <span className="viewer-render-status" role="status">
              {renderStatus === 'queued' ? (
                es.viewer.renderQueued
              ) : (
                <>
                  {es.viewer.rendering}
                  <progress aria-label={es.viewer.renderProgress} />
                </>
              )}
            </span>
          )}
        {renderError && (
          <span className="viewer-render-status" role="alert">
            {es.viewer.renderError}
          </span>
        )}
        <div className="viewer-canvas-content">
          <canvas
            aria-label={`${es.viewer.pageCanvas}, ${es.viewer.pageNumber} ${formatNumber(pageNumber)} ${es.viewer.of} ${formatNumber(pageCount)}`}
            role="img"
          />
        </div>
      </div>
    </section>
  );
}

interface PageNumberFormProps {
  pageNumber: number;
  pageCount: number;
  onPageChange: (pageNumber: number) => void;
}

function PageNumberForm({
  pageNumber,
  pageCount,
  onPageChange,
}: PageNumberFormProps) {
  const [pageInput, setPageInput] = useState(String(pageNumber));
  const [pageInputError, setPageInputError] = useState(false);

  function submitPage(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const requestedPage = Number(pageInput);
    if (
      !Number.isSafeInteger(requestedPage) ||
      requestedPage < 1 ||
      requestedPage > pageCount
    ) {
      setPageInputError(true);
      return;
    }

    setPageInputError(false);
    onPageChange(requestedPage);
  }

  return (
    <form
      className="viewer-page-form"
      aria-label={es.viewer.pageNavigation}
      onSubmit={submitPage}
    >
      <label className="visually-hidden" htmlFor="viewer-page-number">
        {es.viewer.pageNumber}
      </label>
      <input
        id="viewer-page-number"
        type="number"
        value={pageInput}
        aria-invalid={pageInputError}
        aria-describedby={pageInputError ? 'viewer-page-error' : undefined}
        onChange={(event) => {
          setPageInput(event.currentTarget.value);
          setPageInputError(false);
        }}
      />
      <span aria-hidden="true">/ {formatNumber(pageCount)}</span>
      <button className="viewer-control" type="submit">
        {es.viewer.goToPage}
      </button>
      {pageInputError && (
        <span
          id="viewer-page-error"
          className="viewer-input-error"
          role="alert"
        >
          {es.viewer.invalidPage.replace('{count}', formatNumber(pageCount))}
        </span>
      )}
    </form>
  );
}
