import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { PageViewer } from './PageViewer';
import { PageRenderQueue } from '../../pdf/page-render-queue';

const originalClientWidth = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'clientWidth',
);
const originalClientHeight = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'clientHeight',
);

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    value: 640,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    value: 480,
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalClientWidth) {
    Object.defineProperty(
      HTMLElement.prototype,
      'clientWidth',
      originalClientWidth,
    );
  }
  if (originalClientHeight) {
    Object.defineProperty(
      HTMLElement.prototype,
      'clientHeight',
      originalClientHeight,
    );
  }
});

describe('PageViewer render queue integration', () => {
  it('announces indeterminate progress and releases a page after cancellation', async () => {
    let resolvePage!: (page: PDFPageProxy) => void;
    const getPage = vi.fn(
      () =>
        new Promise<PDFPageProxy>((resolve) => {
          resolvePage = resolve;
        }),
    );
    const document = { getPage } as unknown as PDFDocumentProxy;
    const renderQueue = new PageRenderQueue();
    const { unmount } = render(
      <PageViewer
        document={document}
        pageId="document-1:page:1"
        sourcePageNumber={1}
        rotationDeltaDegrees={0}
        pageGeometry={null}
        cropBox={null}
        pageNumber={1}
        pageCount={1}
        canMoveUp={false}
        canMoveDown={false}
        pageActionsDisabled={false}
        onPageChange={vi.fn()}
        onMovePage={vi.fn()}
        onDuplicatePage={vi.fn()}
        onRotatePage={vi.fn()}
        onDeletePage={vi.fn()}
        onPageInfo={vi.fn()}
        onImport={vi.fn()}
        importDisabled={false}
        renderQueue={renderQueue}
      />,
    );

    await waitFor(() => expect(getPage).toHaveBeenCalledOnce());
    expect(
      screen.getByRole('progressbar', { name: 'Progreso de renderizado' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Página del documento' }),
    ).toHaveAttribute('aria-busy', 'true');

    const cleanupPage = vi.fn();
    unmount();
    resolvePage({ cleanup: cleanupPage } as unknown as PDFPageProxy);
    await waitFor(() => expect(cleanupPage).toHaveBeenCalledOnce());
    renderQueue.dispose();
  });

  it('clears a page error when a new render attempt is queued', async () => {
    let getPageCalls = 0;
    let resolveRetryPage!: (page: PDFPageProxy) => void;
    const failedPage = {
      getViewport: () => ({ width: 0, height: 0 }),
      cleanup: vi.fn(),
    } as unknown as PDFPageProxy;
    const getPage = vi.fn(() => {
      if (getPageCalls++ === 0) {
        return Promise.resolve(failedPage);
      }
      return new Promise<PDFPageProxy>((resolve) => {
        resolveRetryPage = resolve;
      });
    });
    const document = { getPage } as unknown as PDFDocumentProxy;
    const renderQueue = new PageRenderQueue();
    const { unmount } = render(
      <PageViewer
        document={document}
        pageId="document-1:page:1"
        sourcePageNumber={1}
        rotationDeltaDegrees={0}
        pageGeometry={null}
        cropBox={null}
        pageNumber={1}
        pageCount={1}
        canMoveUp={false}
        canMoveDown={false}
        pageActionsDisabled={false}
        onPageChange={vi.fn()}
        onMovePage={vi.fn()}
        onDuplicatePage={vi.fn()}
        onRotatePage={vi.fn()}
        onDeletePage={vi.fn()}
        onPageInfo={vi.fn()}
        onImport={vi.fn()}
        importDisabled={false}
        renderQueue={renderQueue}
      />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo mostrar esta página del PDF.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Aumentar zoom' }));
    await waitFor(() => expect(getPage).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', { name: 'Progreso de renderizado' }),
    ).toBeInTheDocument();

    const cleanupPage = vi.fn();
    unmount();
    resolveRetryPage({ cleanup: cleanupPage } as unknown as PDFPageProxy);
    await waitFor(() => expect(cleanupPage).toHaveBeenCalledOnce());
    renderQueue.dispose();
  });
});
