import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { es } from '../../i18n/es';
import { formatNumber } from '../../i18n/format';
import { getBlankPageStatusLabel } from '../blank-detection/presentation';
import { getOrientationStatusLabel } from '../orientation/presentation';
import type { PageRenderQueue } from '../../pdf/page-render-queue';
import { normalizePageRotation } from '../../pdf/page-rotation';
import type { ProjectPage } from '../../store/project-store';
import { ByteLruCache } from './thumbnail-cache';

const rowHeight = 220;
const maxThumbnailWidth = 168;
const maxThumbnailHeight = 170;

interface ThumbnailListProps {
  documentId: string;
  document: PDFDocumentProxy;
  pages: readonly ProjectPage[];
  selectedPageId: string | null;
  onSelectPage: (pageId: string) => void;
  onRestorePage: (pageId: string) => void;
  selectedOrientationPageIds: ReadonlySet<string>;
  onToggleOrientationPage: (pageId: string) => void;
  pageActionsDisabled: boolean;
  cache: ByteLruCache<string, ImageBitmap>;
  renderQueue: PageRenderQueue;
}

export function ThumbnailList({
  documentId,
  document,
  pages,
  selectedPageId,
  onSelectPage,
  onRestorePage,
  selectedOrientationPageIds,
  onToggleOrientationPage,
  pageActionsDisabled,
  cache,
  renderQueue,
}: ThumbnailListProps) {
  const scrollElementRef = useRef<HTMLDivElement>(null);
  const activePageNumbers = new Map<string, number>();
  pages.forEach((page) => {
    if (!page.isDeleted) {
      activePageNumbers.set(page.id, activePageNumbers.size + 1);
    }
  });
  const selectedIndex = pages.findIndex(
    (page) => page.id === selectedPageId && !page.isDeleted,
  );
  const getPageAt = (index: number): ProjectPage => {
    const page = pages[index];
    if (!page) {
      throw new Error(`Thumbnail page at index ${index} is missing.`);
    }
    return page;
  };
  // TanStack Virtual intentionally exposes mutable virtualizer state for the rendered window.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: pages.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => rowHeight,
    getItemKey: (index) => getPageAt(index).id,
    overscan: 3,
  });

  useEffect(() => {
    if (selectedIndex >= 0) {
      virtualizer.scrollToIndex(selectedIndex, { align: 'auto' });
    }
  }, [pages.length, selectedIndex, virtualizer]);

  if (pages.length === 0) {
    return <p className="thumbnail-empty">{es.documents.emptyPages}</p>;
  }

  return (
    <div
      ref={scrollElementRef}
      className="thumbnail-scroll"
      role="region"
      aria-label={es.documents.pagesHeading}
      tabIndex={0}
    >
      <ol
        className="thumbnail-virtual-list"
        aria-label={es.documents.pagesHeading}
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const page = getPageAt(virtualItem.index);
          if (page.isDeleted) {
            return (
              <li
                key={virtualItem.key}
                className="thumbnail-virtual-row"
                aria-posinset={virtualItem.index + 1}
                aria-setsize={pages.length}
                style={{
                  height: `${virtualItem.size}px`,
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <DeletedPageThumbnail
                  page={page}
                  projectPosition={virtualItem.index + 1}
                  disabled={pageActionsDisabled}
                  onRestore={onRestorePage}
                />
              </li>
            );
          }
          const displayPageNumber = activePageNumbers.get(page.id);
          if (displayPageNumber === undefined) {
            throw new Error(`Active thumbnail "${page.id}" has no page number.`);
          }
          return (
            <li
              key={virtualItem.key}
              className="thumbnail-virtual-row"
              aria-posinset={virtualItem.index + 1}
              aria-setsize={pages.length}
              style={{
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <PageThumbnail
                cache={cache}
                document={document}
                documentId={documentId}
                page={page}
                displayPageNumber={displayPageNumber}
                analysisLabel={getBlankPageStatusLabel(
                  page.blankAnalysis,
                  page.blankReviewDecision,
                )}
                orientationLabel={getOrientationStatusLabel(
                  page.orientationAnalysis,
                  page.rotationDeltaDegrees,
                )}
                orientationSelected={selectedOrientationPageIds.has(page.id)}
                orientationSelectionDisabled={pageActionsDisabled}
                onToggleOrientationPage={onToggleOrientationPage}
                selected={page.id === selectedPageId}
                onSelect={onSelectPage}
                renderQueue={renderQueue}
              />
            </li>
          );
        })}
      </ol>
    </div>
  );
}

interface DeletedPageThumbnailProps {
  page: ProjectPage;
  projectPosition: number;
  disabled: boolean;
  onRestore: (pageId: string) => void;
}

function DeletedPageThumbnail({
  page,
  projectPosition,
  disabled,
  onRestore,
}: DeletedPageThumbnailProps) {
  return (
    <figure className="thumbnail-card thumbnail-card-deleted">
      <div className="thumbnail-deleted-image" aria-hidden="true">
        {es.pages.deleted}
      </div>
      <figcaption>
        {es.pages.deletedPage} · {es.documents.pageLabel}{' '}
        {formatNumber(page.sourcePageNumber)}
        {page.duplicatedFromPageId && ` · ${es.pages.duplicateLabel}`}
      </figcaption>
      <button
        className="thumbnail-restore"
        type="button"
        aria-label={`${es.pages.restore} ${formatNumber(projectPosition)}`}
        disabled={disabled}
        onClick={() => onRestore(page.id)}
      >
        {es.pages.restore}
      </button>
    </figure>
  );
}

interface PageThumbnailProps {
  cache: ByteLruCache<string, ImageBitmap>;
  document: PDFDocumentProxy;
  documentId: string;
  page: ProjectPage;
  displayPageNumber: number;
  analysisLabel: string | null;
  orientationLabel: string | null;
  orientationSelected: boolean;
  orientationSelectionDisabled: boolean;
  onToggleOrientationPage: (pageId: string) => void;
  selected: boolean;
  onSelect: (pageId: string) => void;
  renderQueue: PageRenderQueue;
}

function PageThumbnail({
  cache,
  document,
  documentId,
  page,
  displayPageNumber,
  analysisLabel,
  orientationLabel,
  orientationSelected,
  orientationSelectionDisabled,
  onToggleOrientationPage,
  selected,
  onSelect,
  renderQueue,
}: PageThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);
  const [renderStatus, setRenderStatus] = useState<
    'queued' | 'running' | 'completed' | 'cancelled' | 'failed'
  >('queued');
  const cacheKey = `${documentId}:${page.sourcePageNumber}:${page.rotationDeltaDegrees}`;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const targetCanvas = canvas;

    let cancelled = false;
    targetCanvas.width = 0;
    targetCanvas.height = 0;
    targetCanvas.style.width = '';
    targetCanvas.style.height = '';
    setError(false);

    const cachedImage = cache.get(cacheKey);
    if (cachedImage) {
      targetCanvas.width = cachedImage.width;
      targetCanvas.height = cachedImage.height;
      const context = targetCanvas.getContext('2d', { alpha: false });
      if (context) {
        context.drawImage(cachedImage, 0, 0);
        queueMicrotask(() => {
          if (!cancelled) {
            setRenderStatus('completed');
          }
        });
      } else {
        setError(true);
        queueMicrotask(() => {
          if (!cancelled) {
            setRenderStatus('failed');
          }
        });
      }

      return;
    }

    const renderHandle = renderQueue.enqueue({
      priority: 'thumbnail',
      onStatus: (status) => {
        if (!cancelled) {
          setRenderStatus(status);
        }
      },
      run: async (signal) => {
        if (signal.aborted) {
          return;
        }
        const sourcePage = await document.getPage(page.sourcePageNumber);
        try {
          if (signal.aborted) {
            return;
          }

          const rotation = normalizePageRotation(
            sourcePage.rotate + page.rotationDeltaDegrees,
          );
          const baseViewport = sourcePage.getViewport({ scale: 1, rotation });
          const scale = Math.min(
            maxThumbnailWidth / baseViewport.width,
            maxThumbnailHeight / baseViewport.height,
            1,
          );
          const viewport = sourcePage.getViewport({ scale, rotation });
          targetCanvas.width = Math.max(1, Math.ceil(viewport.width));
          targetCanvas.height = Math.max(1, Math.ceil(viewport.height));

          const context = targetCanvas.getContext('2d', { alpha: false });
          if (!context) {
            throw new Error('Canvas 2D context is unavailable.');
          }

          const renderTask = sourcePage.render({
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
          if (signal.aborted) {
            return;
          }

          const bitmap = await createImageBitmap(targetCanvas);
          if (signal.aborted) {
            bitmap.close();
            return;
          }
          cache.set(cacheKey, bitmap);
        } finally {
          sourcePage.cleanup();
        }
      },
    });

    void renderHandle.promise.catch(() => {
      if (!cancelled) {
        setError(true);
      }
    });

    return () => {
      cancelled = true;
      renderHandle.cancel();
    };
  }, [
    cache,
    cacheKey,
    document,
    page.rotationDeltaDegrees,
    page.sourcePageNumber,
    renderQueue,
  ]);

  return (
    <figure className="thumbnail-card">
      <button
        className={`thumbnail-select${selected ? ' is-selected' : ''}`}
        type="button"
        aria-label={`${es.viewer.selectPage} ${formatNumber(displayPageNumber)}`}
        aria-pressed={selected}
        onClick={() => onSelect(page.id)}
      >
        <span className="thumbnail-image">
          <canvas
            ref={canvasRef}
            aria-label={`${es.documents.pageLabel} ${formatNumber(displayPageNumber)}`}
            className={error ? 'thumbnail-canvas has-error' : 'thumbnail-canvas'}
          />
          {error && (
            <span className="thumbnail-error" role="status">
              {es.documents.thumbnailError}
            </span>
          )}
          {!error &&
            (renderStatus === 'queued' || renderStatus === 'running') && (
              <span className="thumbnail-progress" aria-hidden="true">
                {renderStatus === 'queued'
                  ? es.viewer.renderQueued
                  : es.viewer.rendering}
              </span>
            )}
        </span>
      </button>
      <figcaption>
        <span>
          {es.documents.pageLabel} {formatNumber(displayPageNumber)}
        </span>
        <label className="thumbnail-orientation-select">
          <input
            type="checkbox"
            aria-label={`${es.orientation.selectForBatch} ${formatNumber(displayPageNumber)}`}
            checked={orientationSelected}
            disabled={orientationSelectionDisabled}
            onChange={() => onToggleOrientationPage(page.id)}
          />
        </label>
      </figcaption>
      {analysisLabel && (
        <span className="thumbnail-analysis-label">{analysisLabel}</span>
      )}
      {orientationLabel && (
        <span className="thumbnail-orientation-label">{orientationLabel}</span>
      )}
    </figure>
  );
}
