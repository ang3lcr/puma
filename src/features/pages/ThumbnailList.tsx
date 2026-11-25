import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { es } from '../../i18n/es';
import { formatNumber } from '../../i18n/format';
import type { PageRenderQueue } from '../../pdf/page-render-queue';
import { ByteLruCache } from './thumbnail-cache';

const rowHeight = 220;
const maxThumbnailWidth = 168;
const maxThumbnailHeight = 170;

interface ThumbnailListProps {
  documentId: string;
  document: PDFDocumentProxy;
  pageCount: number;
  selectedPageNumber: number;
  onSelectPage: (pageNumber: number) => void;
  cache: ByteLruCache<string, ImageBitmap>;
  renderQueue: PageRenderQueue;
}

export function ThumbnailList({
  documentId,
  document,
  pageCount,
  selectedPageNumber,
  onSelectPage,
  cache,
  renderQueue,
}: ThumbnailListProps) {
  const scrollElementRef = useRef<HTMLDivElement>(null);
  // TanStack Virtual intentionally exposes mutable virtualizer state for the rendered window.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: pageCount,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => rowHeight,
    getItemKey: (index) => `${documentId}:${index + 1}`,
    overscan: 3,
  });

  useEffect(() => {
    if (pageCount > 0) {
      virtualizer.scrollToIndex(selectedPageNumber - 1, { align: 'auto' });
    }
  }, [pageCount, selectedPageNumber, virtualizer]);

  if (pageCount === 0) {
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
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <li
            key={virtualItem.key}
            className="thumbnail-virtual-row"
            aria-posinset={virtualItem.index + 1}
            aria-setsize={pageCount}
            style={{
              height: `${virtualItem.size}px`,
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            <PageThumbnail
              cache={cache}
              document={document}
              documentId={documentId}
              pageNumber={virtualItem.index + 1}
              selected={virtualItem.index + 1 === selectedPageNumber}
              onSelect={onSelectPage}
              renderQueue={renderQueue}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

interface PageThumbnailProps {
  cache: ByteLruCache<string, ImageBitmap>;
  document: PDFDocumentProxy;
  documentId: string;
  pageNumber: number;
  selected: boolean;
  onSelect: (pageNumber: number) => void;
  renderQueue: PageRenderQueue;
}

function PageThumbnail({
  cache,
  document,
  documentId,
  pageNumber,
  selected,
  onSelect,
  renderQueue,
}: PageThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);
  const [renderStatus, setRenderStatus] = useState<
    'queued' | 'running' | 'completed' | 'cancelled' | 'failed'
  >('queued');
  const cacheKey = `${documentId}:${pageNumber}`;

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
        const page = await document.getPage(pageNumber);
        try {
          if (signal.aborted) {
            return;
          }

          const baseViewport = page.getViewport({ scale: 1 });
          const scale = Math.min(
            maxThumbnailWidth / baseViewport.width,
            maxThumbnailHeight / baseViewport.height,
            1,
          );
          const viewport = page.getViewport({ scale });
          targetCanvas.width = Math.max(1, Math.ceil(viewport.width));
          targetCanvas.height = Math.max(1, Math.ceil(viewport.height));

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
          page.cleanup();
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
  }, [cache, cacheKey, document, pageNumber, renderQueue]);

  return (
    <figure className="thumbnail-card">
      <button
        className={`thumbnail-select${selected ? ' is-selected' : ''}`}
        type="button"
        aria-label={`${es.viewer.selectPage} ${formatNumber(pageNumber)}`}
        aria-pressed={selected}
        onClick={() => onSelect(pageNumber)}
      >
        <span className="thumbnail-image">
          <canvas
            ref={canvasRef}
            aria-label={`${es.documents.pageLabel} ${formatNumber(pageNumber)}`}
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
        {es.documents.pageLabel} {formatNumber(pageNumber)}
      </figcaption>
    </figure>
  );
}
