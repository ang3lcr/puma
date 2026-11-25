import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { es } from '../../i18n/es';
import { formatNumber } from '../../i18n/format';
import { ByteLruCache } from './thumbnail-cache';

const rowHeight = 220;
const maxThumbnailWidth = 168;
const maxThumbnailHeight = 170;

interface ThumbnailListProps {
  documentId: string;
  document: PDFDocumentProxy;
  pageCount: number;
  cache: ByteLruCache<string, ImageBitmap>;
}

export function ThumbnailList({
  documentId,
  document,
  pageCount,
  cache,
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
}

function PageThumbnail({
  cache,
  document,
  documentId,
  pageNumber,
}: PageThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);
  const cacheKey = `${documentId}:${pageNumber}`;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const targetCanvas = canvas;

    let cancelled = false;
    let page: Awaited<ReturnType<PDFDocumentProxy['getPage']>> | null = null;
    let renderTask: ReturnType<
      Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']
    > | null = null;
    setError(false);

    const cachedImage = cache.get(cacheKey);
    if (cachedImage) {
      canvas.width = cachedImage.width;
      canvas.height = cachedImage.height;
      const context = canvas.getContext('2d', { alpha: false });
      if (context) {
        context.drawImage(cachedImage, 0, 0);
      } else {
        setError(true);
      }

      return;
    }

    async function renderThumbnail(): Promise<void> {
      try {
        page = await document.getPage(pageNumber);
        if (cancelled) {
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

        renderTask = page.render({
          canvas: targetCanvas,
          canvasContext: context,
          viewport,
        });
        await renderTask.promise;
        if (cancelled) {
          return;
        }

        const bitmap = await createImageBitmap(targetCanvas);
        if (cancelled) {
          bitmap.close();
          return;
        }
        cache.set(cacheKey, bitmap);
      } catch {
        if (!cancelled) {
          setError(true);
        }
      } finally {
        page?.cleanup();
      }
    }

    void renderThumbnail();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [cache, cacheKey, document, pageNumber]);

  return (
    <figure className="thumbnail-card">
      <div className="thumbnail-image">
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
      </div>
      <figcaption>
        {es.documents.pageLabel} {formatNumber(pageNumber)}
      </figcaption>
    </figure>
  );
}
