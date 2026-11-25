import { useEffect, useRef, useState } from 'react';
import type {
  FormEvent,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { es } from '../../i18n/es';
import { formatNumber } from '../../i18n/format';
import {
  createCropBoxFromMargins,
  getPageMarginsMm,
  isBoxInside,
  readPdfBox,
} from '../margins/geometry';
import type {
  PageGeometry,
  PageMarginsMm,
  PdfBox,
} from '../margins/types';
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

export type PageInfo = PageGeometry;

interface PageViewerProps {
  document: PDFDocumentProxy;
  pageId: string;
  sourcePageNumber: number;
  rotationDeltaDegrees: number;
  pageGeometry: PageGeometry | null;
  cropBox: PdfBox | null;
  pageNumber: number;
  pageCount: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  pageActionsDisabled: boolean;
  onPageChange: (pageNumber: number) => void;
  onMovePage: (direction: 'up' | 'down') => void;
  onDuplicatePage: () => void;
  onRotatePage: (degrees: 90 | 180 | 270) => void;
  onApplyCropBox: (cropBox: PdfBox | null) => void;
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
  pageId: string;
  width: number;
  height: number;
}

type CropSide = keyof PageMarginsMm;

interface CropDragState {
  pointerId: number;
  pageId: string;
  side: CropSide;
  startX: number;
  startY: number;
  frameWidth: number;
  frameHeight: number;
  geometry: PageGeometry;
  startingMargins: PageMarginsMm;
  cropBox: PdfBox | null;
}

interface CropPreview {
  pageId: string;
  cropBox: PdfBox | null;
}

export function PageViewer({
  document,
  pageId,
  sourcePageNumber,
  rotationDeltaDegrees,
  pageGeometry,
  cropBox,
  pageNumber,
  pageCount,
  canMoveUp,
  canMoveDown,
  pageActionsDisabled,
  onPageChange,
  onMovePage,
  onDuplicatePage,
  onRotatePage,
  onApplyCropBox,
  onDeletePage,
  onPageInfo,
  onImport,
  importDisabled,
  renderQueue,
}: PageViewerProps) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const cropDragRef = useRef<CropDragState | null>(null);
  const [cropPreview, setCropPreview] = useState<CropPreview | null>(null);
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
  const currentPageDimensions =
    pageDimensions?.pageId === pageId ? pageDimensions : null;
  const displayCropBox =
    cropPreview?.pageId === pageId ? cropPreview.cropBox : cropBox;

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
    currentPageDimensions &&
    viewportSize.width > 0 &&
    viewportSize.height > 0
      ? Math.max(
          0.05,
          Math.min(
            (viewportSize.width - 48) / currentPageDimensions.width,
            (viewportSize.height - 48) / currentPageDimensions.height,
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
            pageId,
            width: baseViewport.width,
            height: baseViewport.height,
          });
          const viewBox = readPdfBox(page.view);
          onPageInfo(pageId, {
            widthMillimeters: (baseViewport.width * 25.4) / 72,
            heightMillimeters: (baseViewport.height * 25.4) / 72,
            rotation,
            viewBox,
            userUnit: page.userUnit,
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
  const cropMargins =
    pageGeometry &&
    (displayCropBox === null ||
      isBoxInside(displayCropBox, pageGeometry.viewBox))
      ? getPageMarginsMm(
          pageGeometry.viewBox,
          displayCropBox,
          pageGeometry.userUnit,
          pageGeometry.rotation,
        )
      : null;
  const previewWidth = currentPageDimensions
    ? currentPageDimensions.width * effectiveZoom
    : 0;
  const previewHeight = currentPageDimensions
    ? currentPageDimensions.height * effectiveZoom
    : 0;
  const pixelsPerMillimeter = (72 / 25.4) * effectiveZoom;
  const cropPixels = cropMargins && currentPageDimensions
    ? {
        top: cropMargins.top * pixelsPerMillimeter,
        right: cropMargins.right * pixelsPerMillimeter,
        bottom: cropMargins.bottom * pixelsPerMillimeter,
        left: cropMargins.left * pixelsPerMillimeter,
      }
    : null;

  function handleCropPointerDown(
    side: CropSide,
    event: ReactPointerEvent<HTMLDivElement>,
  ): void {
    if (
      pageActionsDisabled ||
      !pageGeometry ||
      !currentPageDimensions ||
      !cropMargins ||
      !event.isPrimary ||
      event.button !== 0
    ) {
      return;
    }

    const frame = event.currentTarget.closest('.viewer-page-frame');
    const bounds = frame?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      return;
    }

    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    cropDragRef.current = {
      pointerId: event.pointerId,
      pageId,
      side,
      startX: event.clientX,
      startY: event.clientY,
      frameWidth: bounds.width,
      frameHeight: bounds.height,
      geometry: pageGeometry,
      startingMargins: cropMargins,
      cropBox: displayCropBox,
    };
  }

  function handleCropPointerMove(
    event: ReactPointerEvent<HTMLDivElement>,
  ): void {
    const drag = cropDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.pageId !== pageId) {
      return;
    }

    const horizontalDelta =
      ((event.clientX - drag.startX) / drag.frameWidth) *
      drag.geometry.widthMillimeters;
    const verticalDelta =
      ((event.clientY - drag.startY) / drag.frameHeight) *
      drag.geometry.heightMillimeters;
    const marginDelta =
      drag.side === 'top'
        ? verticalDelta
        : drag.side === 'bottom'
          ? -verticalDelta
          : drag.side === 'left'
            ? horizontalDelta
            : -horizontalDelta;
    const margins = {
      ...drag.startingMargins,
      [drag.side]: Math.max(
        0,
        drag.startingMargins[drag.side] + marginDelta,
      ),
    };
    const result = createCropBoxFromMargins(
      drag.geometry.viewBox,
      drag.geometry.userUnit,
      drag.geometry.rotation,
      margins,
    );
    if (!result.ok) {
      return;
    }

    drag.cropBox = result.cropBox;
    setCropPreview({ pageId, cropBox: result.cropBox });
  }

  function finishCropPointer(
    event: ReactPointerEvent<HTMLDivElement>,
    cancelled: boolean,
  ): void {
    const drag = cropDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    cropDragRef.current = null;
    setCropPreview(null);
    if (!cancelled) {
      onApplyCropBox(drag.cropBox);
    }
  }

  function handleCropHandleKeyDown(
    side: CropSide,
    event: KeyboardEvent<HTMLDivElement>,
  ): void {
    if (event.key === 'Escape' && cropDragRef.current?.pageId === pageId) {
      event.preventDefault();
      cropDragRef.current = null;
      setCropPreview(null);
      return;
    }
    if (
      pageActionsDisabled ||
      !pageGeometry ||
      !cropMargins ||
      !['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'Home'].includes(
        event.key,
      )
    ) {
      return;
    }

    event.preventDefault();
    const delta =
      event.key === 'Home'
        ? -cropMargins[side]
        : event.key === 'ArrowUp' || event.key === 'ArrowRight'
          ? event.shiftKey
            ? 10
            : 1
          : event.shiftKey
            ? -10
            : -1;
    const margins = {
      ...cropMargins,
      [side]: Math.max(0, cropMargins[side] + delta),
    };
    const result = createCropBoxFromMargins(
      pageGeometry.viewBox,
      pageGeometry.userUnit,
      pageGeometry.rotation,
      margins,
    );
    if (result.ok) {
      onApplyCropBox(result.cropBox);
    }
  }

  function renderCropHandle(side: CropSide): ReactNode {
    if (!cropPixels || !cropMargins || !pageGeometry) {
      return null;
    }

    const horizontal = side === 'top' || side === 'bottom';
    const label = {
      top: es.margins.cropTopHandle,
      right: es.margins.cropRightHandle,
      bottom: es.margins.cropBottomHandle,
      left: es.margins.cropLeftHandle,
    }[side];
    const oppositeSides: Record<CropSide, CropSide> = {
      top: 'bottom',
      right: 'left',
      bottom: 'top',
      left: 'right',
    };
    const oppositeSide = oppositeSides[side];
    const dimension = horizontal
      ? pageGeometry.heightMillimeters
      : pageGeometry.widthMillimeters;
    const maximum = Math.max(
      cropMargins[side],
      dimension - cropMargins[oppositeSide] - 0.01,
    );
    const position =
      side === 'top'
        ? {
            top: cropPixels.top,
            left: cropPixels.left,
            right: cropPixels.right,
          }
        : side === 'bottom'
          ? {
              bottom: cropPixels.bottom,
              left: cropPixels.left,
              right: cropPixels.right,
            }
          : side === 'left'
            ? {
                top: cropPixels.top,
                bottom: cropPixels.bottom,
                left: cropPixels.left,
              }
            : {
                top: cropPixels.top,
                bottom: cropPixels.bottom,
                right: cropPixels.right,
              };

    return (
      <div
        key={side}
        className={`crop-preview-handle crop-preview-handle-${side}${pageActionsDisabled ? ' is-disabled' : ''}`}
        role="slider"
        aria-label={label}
        aria-orientation={horizontal ? 'horizontal' : 'vertical'}
        aria-valuemin={0}
        aria-valuemax={maximum}
        aria-valuenow={cropMargins[side]}
        aria-valuetext={`${formatNumber(cropMargins[side], { maximumFractionDigits: 2 })} mm`}
        aria-disabled={pageActionsDisabled}
        tabIndex={pageActionsDisabled ? -1 : 0}
        style={position}
        onPointerDown={(event) => handleCropPointerDown(side, event)}
        onPointerMove={handleCropPointerMove}
        onPointerUp={(event) => finishCropPointer(event, false)}
        onPointerCancel={(event) => finishCropPointer(event, true)}
        onLostPointerCapture={(event) => finishCropPointer(event, true)}
        onKeyDown={(event) => handleCropHandleKeyDown(side, event)}
      />
    );
  }

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
            onClick={() => onRotatePage(90)}
          >
            ↻
          </button>
          <button
            className="viewer-control"
            type="button"
            aria-label={es.pages.rotateCounterclockwise}
            title={es.pages.rotateCounterclockwise}
            disabled={pageActionsDisabled}
            onClick={() => onRotatePage(270)}
          >
            ↺
          </button>
          <button
            className="viewer-control"
            type="button"
            aria-label={es.pages.rotateHalfTurn}
            title={es.pages.rotateHalfTurn}
            disabled={pageActionsDisabled}
            onClick={() => onRotatePage(180)}
          >
            ↻180
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
          <div
            className="viewer-page-frame"
            style={
              currentPageDimensions
                ? {
                    width: `${previewWidth}px`,
                    height: `${previewHeight}px`,
                  }
                : undefined
            }
          >
            <canvas
              aria-label={`${es.viewer.pageCanvas}, ${es.viewer.pageNumber} ${formatNumber(pageNumber)} ${es.viewer.of} ${formatNumber(pageCount)}`}
              role="img"
            />
            {cropPixels && (
              <div
                className="crop-preview-overlay"
                role="group"
                aria-label={es.margins.heading}
                aria-disabled={pageActionsDisabled}
              >
                {cropPixels.top > 0 && (
                  <div
                    className="crop-preview-shade"
                    aria-hidden="true"
                    style={{ top: 0, left: 0, right: 0, height: cropPixels.top }}
                  />
                )}
                {cropPixels.bottom > 0 && (
                  <div
                    className="crop-preview-shade"
                    aria-hidden="true"
                    style={{
                      bottom: 0,
                      left: 0,
                      right: 0,
                      height: cropPixels.bottom,
                    }}
                  />
                )}
                {cropPixels.left > 0 && (
                  <div
                    className="crop-preview-shade"
                    aria-hidden="true"
                    style={{
                      top: cropPixels.top,
                      bottom: cropPixels.bottom,
                      left: 0,
                      width: cropPixels.left,
                    }}
                  />
                )}
                {cropPixels.right > 0 && (
                  <div
                    className="crop-preview-shade"
                    aria-hidden="true"
                    style={{
                      top: cropPixels.top,
                      bottom: cropPixels.bottom,
                      right: 0,
                      width: cropPixels.right,
                    }}
                  />
                )}
                <div
                  className="crop-preview-border"
                  aria-hidden="true"
                  style={{
                    top: cropPixels.top,
                    right: cropPixels.right,
                    bottom: cropPixels.bottom,
                    left: cropPixels.left,
                  }}
                />
                {renderCropHandle('top')}
                {renderCropHandle('right')}
                {renderCropHandle('bottom')}
                {renderCropHandle('left')}
              </div>
            )}
          </div>
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
